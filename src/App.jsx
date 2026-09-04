import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell
} from "recharts";
import { db, ref, set, onValue, firebaseConfigured, DATA_PATH } from "./firebaseClient";

const STATUS = { NOT_HANDLED: "未実施", APO_CANCEL: "アポキャン", REVISIT: "再訪", WON: "受注", LOST: "失注" };
const RESULT_OPTIONS = [STATUS.NOT_HANDLED, STATUS.APO_CANCEL, STATUS.REVISIT, STATUS.WON, STATUS.LOST];
const PRODUCTS = ["addream", "AddAI"];
const LOSS_REASONS = ["タイミングNG", "決済権なし", "考えたい", "誰かに相談必須", "費用感", "ニーズなし", "他社の話も聞きたい", "他社でやってる", "成果報酬でないとやらない", "内容刺さらず", "その他"];

const isVisited = (d) => d.status === STATUS.REVISIT || d.status === STATUS.WON || d.status === STATUS.LOST;
const isDecided = (d) => d.status === STATUS.WON || d.status === STATUS.LOST;

const uid = () => Math.random().toString(36).slice(2, 10);
const pct = (n) => (isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");
const today = () => new Date().toISOString().slice(0, 10);
const openPicker = (e) => { try { e.target.showPicker && e.target.showPicker(); } catch (err) {} };

const monthKey = (dateStr) => (dateStr ? dateStr.slice(0, 7) : "");
const inMonth = (dateStr, month) => (month === "all" ? true : monthKey(dateStr) === month);
const monthLabel = (month) => {
  if (month === "all") return "全期間";
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
};
function availableMonths(data) {
  const set = new Set();
  data.calls.forEach((c) => c.date && set.add(monthKey(c.date)));
  data.deals.forEach((d) => {
    if (d.apoDate) set.add(monthKey(d.apoDate));
    if (d.apptDate) set.add(monthKey(d.apptDate));
  });
  return Array.from(set).sort().reverse();
}

const startOfWeek = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekLabel = (weekStart) => {
  if (weekStart === "all") return "全期間";
  const end = addDays(weekStart, 6);
  const [, m1, d1] = weekStart.split("-");
  const [, m2, d2] = end.split("-");
  return `${Number(m1)}/${Number(d1)}〜${Number(m2)}/${Number(d2)}`;
};
function availableWeeks(data) {
  const set = new Set();
  data.calls.forEach((c) => c.date && set.add(startOfWeek(c.date)));
  data.deals.forEach((d) => {
    if (d.apoDate) set.add(startOfWeek(d.apoDate));
    if (d.apptDate) set.add(startOfWeek(d.apptDate));
  });
  return Array.from(set).sort().reverse();
}

// A "period" is { type: 'month' | 'week', value: 'all' | <monthKey|weekStart> }
const inPeriod = (dateStr, period) => {
  if (!period || period.value === "all") return true;
  if (!dateStr) return false;
  return period.type === "week" ? startOfWeek(dateStr) === period.value : monthKey(dateStr) === period.value;
};
const periodLabel = (period) =>
  period.type === "week" ? weekLabel(period.value) : monthLabel(period.value);
const availablePeriods = (data, type) => (type === "week" ? availableWeeks(data) : availableMonths(data));

const currentMonthStr = () => today().slice(0, 7);
const emptyFive = () => ["", "", "", "", ""];
function weeksInMonth(monthStr) {
  if (!monthStr) return [];
  const [y, m] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const set = new Set();
  for (let day = 1; day <= daysInMonth; day++) {
    set.add(startOfWeek(`${monthStr}-${String(day).padStart(2, "0")}`));
  }
  return Array.from(set).sort();
}

function emptyData() {
  return { reps: [], calls: [], deals: [] };
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("home");
  const [toast, setToast] = useState("");
  const [periodType, setPeriodType] = useState("month");
  const [periodValue, setPeriodValue] = useState("all");
  const [connError, setConnError] = useState(false);
  const savingRef = useRef(false);

  const flash = (msg) => {
    setToast(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    if (!firebaseConfigured) {
      setData(emptyData());
      setConnError(true);
      setLoading(false);
      return;
    }
    const dataRef = ref(db, DATA_PATH);
    const unsubscribe = onValue(
      dataRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          if (!savingRef.current) setData(val);
          savingRef.current = false;
        } else {
          const seed = emptyData();
          set(dataRef, seed);
          setData(seed);
        }
        setLoading(false);
      },
      () => {
        setConnError(true);
        setData(emptyData());
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    if (!firebaseConfigured) return;
    savingRef.current = true;
    try {
      await set(ref(db, DATA_PATH), next);
    } catch (e) {
      flash("保存に失敗しました。通信環境をご確認ください");
    }
  }, []);

  const period = useMemo(() => ({ type: periodType, value: periodValue }), [periodType, periodValue]);
  const stats = useMemo(
    () => (data ? calcStats(data.reps, data.calls, data.deals, period) : []),
    [data, period]
  );
  const periodOptions = useMemo(() => (data ? availablePeriods(data, periodType) : []), [data, periodType]);

  const handlePeriodTypeChange = (type) => {
    setPeriodType(type);
    setPeriodValue("all");
  };

  if (loading || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#3A362F", background: "#F7F4EE" }}>
        <StyleBlock />
        読み込み中…
      </div>
    );
  }

  return (
    <div className="board-root">
      <StyleBlock />
      {connError && (
        <div className="conn-banner">
          Firebaseに接続できていません。.env に VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN / VITE_FIREBASE_DATABASE_URL / VITE_FIREBASE_PROJECT_ID を設定してください（README参照）。データはこのセッション内のみ保持されます。
        </div>
      )}
      <header className="board-header">
        <div className="header-left">
          <span className="header-eyebrow">SNS AD SALES</span>
          <h1>大阪営業所 成績ボード</h1>
        </div>
        <div className="header-note">データはチーム全員に共有されます</div>
      </header>

      <div className="board-body">
        <nav className="board-nav">
          {[
            ["home", "ホーム"],
            ["strategy", "戦略・戦術"],
            ["calls", "コール入力"],
            ["deals", "アポ・商談"],
            ["reps", "営業メンバー"],
            ["data", "データ移行"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={"nav-btn" + (tab === key ? " active" : "")}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="board-main">
          {tab === "home" && (
            <HomeTab
              stats={stats}
              data={data}
              period={period}
              periodType={periodType}
              periodOptions={periodOptions}
              onPeriodTypeChange={handlePeriodTypeChange}
              onPeriodValueChange={setPeriodValue}
            />
          )}
          {tab === "strategy" && <StrategyTab data={data} persist={persist} />}
          {tab === "calls" && <CallsTab data={data} persist={persist} flash={flash} />}
          {tab === "deals" && <DealsTab data={data} persist={persist} flash={flash} />}
          {tab === "reps" && <RepsTab data={data} persist={persist} flash={flash} />}
          {tab === "data" && <DataTab data={data} persist={persist} flash={flash} />}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ---------- calculations ----------
function calcStats(reps, calls, deals, period = { type: "month", value: "all" }) {
  return reps.map((rep) => {
    const repCalls = calls.filter((c) => c.rep === rep && inPeriod(c.date, period));
    const callCount = repCalls.reduce((s, c) => s + Number(c.count || 0), 0);
    const decisionMakerCount = repCalls.reduce((s, c) => s + Number(c.decisionMakers || 0), 0);
    const scheduleSetCount = repCalls.reduce((s, c) => s + Number(c.scheduleSet || 0), 0);
    const apoDeals = deals.filter((d) => d.apoRep === rep && inPeriod(d.apoDate, period));
    const apoCount = apoDeals.length;
    const dueApoDeals = apoDeals.filter((d) => d.apptDate && d.apptDate <= today());
    const visitedApo = dueApoDeals.filter(isVisited).length;

    const meetingDeals = deals.filter((d) => d.meetingRep === rep && isVisited(d) && inPeriod(d.apptDate, period));
    const meetingCount = meetingDeals.length;

    const selfDeals = meetingDeals.filter((d) => d.apoRep === rep);
    const otherDeals = meetingDeals.filter((d) => d.apoRep !== rep);
    const selfDecided = selfDeals.filter(isDecided);
    const otherDecided = otherDeals.filter(isDecided);
    const selfWon = selfDeals.filter((d) => d.status === STATUS.WON).length;
    const otherWon = otherDeals.filter((d) => d.status === STATUS.WON).length;

    const wonDeals = meetingDeals.filter((d) => d.status === STATUS.WON);
    const totalPoints = wonDeals.reduce((s, d) => s + Number(d.wonPoints || 0), 0);
    const avgPoints = wonDeals.length ? totalPoints / wonDeals.length : NaN;

    const lossReasons = {};
    meetingDeals
      .filter((d) => d.status === STATUS.LOST && d.lossReason)
      .forEach((d) => { lossReasons[d.lossReason] = (lossReasons[d.lossReason] || 0) + 1; });
    let topReason = null, topCount = 0;
    Object.entries(lossReasons).forEach(([r, c]) => { if (c > topCount) { topReason = r; topCount = c; } });

    return {
      rep, callCount, decisionMakerCount, scheduleSetCount, apoCount,
      apoRate: callCount ? apoCount / callCount : NaN,
      avgCallsPerApo: apoCount ? callCount / apoCount : NaN,
      visitedApo,
      dueApoCount: dueApoDeals.length,
      visitRate: dueApoDeals.length ? visitedApo / dueApoDeals.length : NaN,
      meetingCount,
      selfWon, selfDecidedCount: selfDecided.length,
      selfRate: selfDecided.length ? selfWon / selfDecided.length : NaN,
      otherWon, otherDecidedCount: otherDecided.length,
      otherRate: otherDecided.length ? otherWon / otherDecided.length : NaN,
      totalWon: selfWon + otherWon,
      totalDecidedCount: selfDecided.length + otherDecided.length,
      totalRate: (selfDecided.length + otherDecided.length)
        ? (selfWon + otherWon) / (selfDecided.length + otherDecided.length)
        : NaN,
      avgPoints, totalPoints,
      lossReasons, topReason, topCount,
    };
  });
}

// ---------- Home / Dashboard ----------
function calcProductStats(deals, period = { type: "month", value: "all" }) {
  return PRODUCTS.map((product) => {
    const apoDeals = deals.filter((d) => (d.product || PRODUCTS[0]) === product && inPeriod(d.apoDate, period));
    const apoCount = apoDeals.length;
    const dueApoDeals = apoDeals.filter((d) => d.apptDate && d.apptDate <= today());
    const visitedCount = dueApoDeals.filter(isVisited).length;

    const productDeals = deals.filter((d) => (d.product || PRODUCTS[0]) === product && isVisited(d) && inPeriod(d.apptDate, period));
    const decided = productDeals.filter(isDecided);
    const wonDeals = productDeals.filter((d) => d.status === STATUS.WON);
    const won = wonDeals.length;
    const lost = productDeals.filter((d) => d.status === STATUS.LOST).length;
    const totalPoints = wonDeals.reduce((s, d) => s + Number(d.wonPoints || 0), 0);
    return {
      product, meetingCount: productDeals.length,
      apoCount, visitedCount, dueApoCount: dueApoDeals.length,
      visitRate: dueApoDeals.length ? visitedCount / dueApoDeals.length : NaN,
      won, lost, decidedCount: decided.length,
      rate: decided.length ? won / decided.length : NaN,
      avgPoints: won ? totalPoints / won : NaN,
    };
  });
}

function HomeTab({ stats, data, period, periodType, periodOptions, onPeriodTypeChange, onPeriodValueChange }) {
  const chartData = stats.map((s) => ({
    name: s.rep,
    自アポ: isFinite(s.selfRate) ? Math.round(s.selfRate * 1000) / 10 : 0,
    他アポ: isFinite(s.otherRate) ? Math.round(s.otherRate * 1000) / 10 : 0,
  }));

  const totalDeals = data.deals.filter((d) => inPeriod(d.apoDate, period)).length;
  const dueDeals = data.deals.filter((d) => inPeriod(d.apoDate, period) && d.apptDate && d.apptDate <= today());
  const totalVisited = dueDeals.filter(isVisited).length;
  const overallVisitRate = dueDeals.length ? totalVisited / dueDeals.length : NaN;
  const decidedThisMonth = data.deals.filter((d) => inPeriod(d.apptDate, period) && isDecided(d));
  const totalWon = decidedThisMonth.filter((d) => d.status === STATUS.WON).length;
  const totalLost = decidedThisMonth.filter((d) => d.status === STATUS.LOST).length;
  const totalPointsSum = decidedThisMonth
    .filter((d) => d.status === STATUS.WON)
    .reduce((s, d) => s + Number(d.wonPoints || 0), 0);
  const avgPointsOverall = totalWon ? totalPointsSum / totalWon : NaN;
  const productStats = calcProductStats(data.deals, period);

  return (
    <div className="tab-panel">
      <div className="panel-head-row month-head">
        <h2 className="month-heading">{periodLabel(period)}の実績</h2>
        <div className="period-controls">
          <div className="period-toggle">
            <button
              className={"period-toggle-btn" + (periodType === "month" ? " active" : "")}
              onClick={() => onPeriodTypeChange("month")}
            >
              月
            </button>
            <button
              className={"period-toggle-btn" + (periodType === "week" ? " active" : "")}
              onClick={() => onPeriodTypeChange("week")}
            >
              週
            </button>
          </div>
          <select value={period.value} onChange={(e) => onPeriodValueChange(e.target.value)} className="filter-select">
            <option value="all">全期間</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>{periodType === "week" ? weekLabel(p) : monthLabel(p)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-strip">
        <KpiCard label="登録アポ" value={totalDeals} />
        <KpiCard label="訪問率" value={pct(overallVisitRate)} />
        <KpiCard label="受注" value={totalWon} accent="win" />
        <KpiCard label="失注" value={totalLost} accent="lose" />
        <KpiCard label="受注率" value={pct(totalWon + totalLost ? totalWon / (totalWon + totalLost) : NaN)} />
        <KpiCard label="平均受注P" value={isFinite(avgPointsOverall) ? avgPointsOverall.toFixed(1) : "—"} />
      </div>

      <section className="panel">
        <h2>営業別 実績</h2>
        <div className="table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>営業</th>
                <th>コール数</th>
                <th>決済者数</th>
                <th>日程切り</th>
                <th>アポ数</th>
                <th>アポ取得率</th>
                <th>1アポ平均コール数</th>
                <th>訪問数</th>
                <th>訪問率</th>
                <th>商談実施数</th>
                <th>受注率</th>
                <th>自アポ受注率</th>
                <th>他アポ受注率</th>
                <th>平均受注P</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.rep}>
                  <td className="rep-cell">{s.rep}</td>
                  <td className="num">{s.callCount}</td>
                  <td className="num">{s.decisionMakerCount}</td>
                  <td className="num">{s.scheduleSetCount}</td>
                  <td className="num">{s.apoCount}</td>
                  <td className="num accent">{pct(s.apoRate)}</td>
                  <td className="num">{isFinite(s.avgCallsPerApo) ? s.avgCallsPerApo.toFixed(1) : "—"}</td>
                  <td className="num">{s.visitedApo}</td>
                  <td className="num accent">{pct(s.visitRate)} <span className="sub">({s.visitedApo}/{s.dueApoCount})</span></td>
                  <td className="num">{s.meetingCount}</td>
                  <td className="num win">{pct(s.totalRate)} <span className="sub">({s.totalWon}/{s.totalDecidedCount})</span></td>
                  <td className="num win">{pct(s.selfRate)} <span className="sub">({s.selfWon}/{s.selfDecidedCount})</span></td>
                  <td className="num win">{pct(s.otherRate)} <span className="sub">({s.otherWon}/{s.otherDecidedCount})</span></td>
                  <td className="num accent">{isFinite(s.avgPoints) ? s.avgPoints.toFixed(1) : "—"}</td>
                </tr>
              ))}
              {stats.length === 0 && (
                <tr><td colSpan={14} className="empty-row">営業メンバーを登録してください</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>受注率比較（自アポ / 他アポ）</h2>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E5DFD2" vertical={false} />
              <XAxis dataKey="name" stroke="#96897A" tick={{ fill: "#96897A", fontFamily: "Noto Sans JP" }} />
              <YAxis stroke="#96897A" tick={{ fill: "#96897A" }} unit="%" />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5DFD2", color: "#3A362F" }} />
              <Legend wrapperStyle={{ fontFamily: "Noto Sans JP", color: "#3A362F" }} />
              <Bar dataKey="自アポ" fill="#7FA98A" radius={[3, 3, 0, 0]} />
              <Bar dataKey="他アポ" fill="#C6996A" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>商材別 訪問率・受注率</h2>
        <div className="product-strip">
          {productStats.map((p) => (
            <div className="product-card" key={p.product}>
              <div className="product-name">{p.product}</div>
              <div className="product-rate">{pct(p.rate)}<span className="product-rate-label">受注率</span></div>
              <div className="product-sub">{p.won}勝 {p.lost}敗（商談実施 {p.meetingCount}件）</div>
              <div className="product-visit">訪問率: {pct(p.visitRate)} <span className="sub">({p.visitedCount}/{p.dueApoCount})</span></div>
              <div className="product-points">平均受注P: {isFinite(p.avgPoints) ? p.avgPoints.toFixed(1) : "—"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>失注理由ランキング</h2>
        <div className="reason-grid">
          {stats.map((s) => {
            const entries = Object.entries(s.lossReasons).sort((a, b) => b[1] - a[1]);
            return (
              <div className="reason-card" key={s.rep}>
                <div className="reason-rep">{s.rep}</div>
                {entries.length === 0 && <div className="reason-empty">失注データなし</div>}
                {entries.slice(0, 3).map(([reason, count], i) => (
                  <div className="reason-row" key={reason}>
                    <span className={"reason-rank" + (i === 0 ? " top" : "")}>{i + 1}</span>
                    <span className="reason-label">{reason}</span>
                    <span className="reason-count">{count}件</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function KpiCard({ label, value, accent }) {
  return (
    <div className={"kpi-card" + (accent ? ` kpi-${accent}` : "")}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

// ---------- Strategy Tab (戦略・戦術) ----------
function StrategyTab({ data, persist }) {
  const [selRep, setSelRep] = useState(data.reps[0] || "");
  const [selMonth, setSelMonth] = useState(currentMonthStr());
  const weeks = useMemo(() => weeksInMonth(selMonth), [selMonth]);
  const [selWeek, setSelWeek] = useState(weeks[0] || "");

  useEffect(() => {
    if (!data.reps.includes(selRep)) setSelRep(data.reps[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.reps]);

  useEffect(() => {
    const list = weeksInMonth(selMonth);
    if (!list.includes(selWeek)) setSelWeek(list[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMonth]);

  const strategy = data.strategy || { monthly: {}, weekly: {} };
  const monthlyEntry = strategy.monthly?.[selMonth]?.[selRep] || { strategy: emptyFive(), tactics: emptyFive() };
  const weeklyEntry = selWeek ? (strategy.weekly?.[selWeek]?.[selRep] || { strategy: emptyFive(), tactics: emptyFive() }) : null;

  const updateMonthly = (field, index, value) => {
    if (!selRep) return;
    const arr = [...(monthlyEntry[field] || emptyFive())];
    arr[index] = value;
    const monthForRep = { ...(strategy.monthly?.[selMonth] || {}), [selRep]: { ...monthlyEntry, [field]: arr } };
    const monthly = { ...(strategy.monthly || {}), [selMonth]: monthForRep };
    persist({ ...data, strategy: { ...strategy, monthly } });
  };

  const updateWeekly = (field, index, value) => {
    if (!selWeek || !selRep) return;
    const base = weeklyEntry || { strategy: emptyFive(), tactics: emptyFive() };
    const arr = [...(base[field] || emptyFive())];
    arr[index] = value;
    const weekForRep = { ...(strategy.weekly?.[selWeek] || {}), [selRep]: { ...base, [field]: arr } };
    const weekly = { ...(strategy.weekly || {}), [selWeek]: weekForRep };
    persist({ ...data, strategy: { ...strategy, weekly } });
  };

  return (
    <div className="tab-panel">
      <section className="panel">
        <div className="panel-head-row">
          <h2>対象者</h2>
          <select value={selRep} onChange={(e) => setSelRep(e.target.value)} className="filter-select">
            {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
            {data.reps.length === 0 && <option value="">営業メンバーを登録してください</option>}
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>月間 戦略・戦術</h2>
          <input
            type="month"
            value={selMonth}
            onChange={(e) => setSelMonth(e.target.value)}
            className="filter-select"
            onClick={openPicker}
          />
        </div>
        <div className="strategy-grid">
          <div>
            <div className="strategy-col-title">戦略</div>
            {monthlyEntry.strategy.map((v, i) => (
              <input
                key={i}
                className="strategy-input"
                value={v}
                placeholder={`戦略 ${i + 1}`}
                onChange={(e) => updateMonthly("strategy", i, e.target.value)}
              />
            ))}
          </div>
          <div>
            <div className="strategy-col-title">戦術</div>
            {monthlyEntry.tactics.map((v, i) => (
              <input
                key={i}
                className="strategy-input"
                value={v}
                placeholder={`戦術 ${i + 1}`}
                onChange={(e) => updateMonthly("tactics", i, e.target.value)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>週間 戦略・戦術</h2>
          <select value={selWeek} onChange={(e) => setSelWeek(e.target.value)} className="filter-select">
            {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
            {weeks.length === 0 && <option value="">対象週なし</option>}
          </select>
        </div>
        {weeklyEntry ? (
          <div className="strategy-grid">
            <div>
              <div className="strategy-col-title">戦略</div>
              {weeklyEntry.strategy.map((v, i) => (
                <input
                  key={i}
                  className="strategy-input"
                  value={v}
                  placeholder={`戦略 ${i + 1}`}
                  onChange={(e) => updateWeekly("strategy", i, e.target.value)}
                />
              ))}
            </div>
            <div>
              <div className="strategy-col-title">戦術</div>
              {weeklyEntry.tactics.map((v, i) => (
                <input
                  key={i}
                  className="strategy-input"
                  value={v}
                  placeholder={`戦術 ${i + 1}`}
                  onChange={(e) => updateWeekly("tactics", i, e.target.value)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-row">対象の週がありません</div>
        )}
      </section>
    </div>
  );
}

// ---------- Calls Tab ----------
function CallsTab({ data, persist, flash }) {
  const [rep, setRep] = useState(data.reps[0] || "");
  const [date, setDate] = useState(today());
  const [count, setCount] = useState("");
  const [decisionMakers, setDecisionMakers] = useState("");
  const [scheduleSet, setScheduleSet] = useState("");

  const add = () => {
    if (!rep) return flash("営業メンバーを選択してください");
    if (!count || Number(count) < 0) return flash("コール数を入力してください");
    const entry = {
      id: uid(), rep, date,
      count: Number(count),
      decisionMakers: Number(decisionMakers || 0),
      scheduleSet: Number(scheduleSet || 0),
    };
    persist({ ...data, calls: [entry, ...data.calls] });
    setCount("");
    setDecisionMakers("");
    setScheduleSet("");
    flash("コール数を登録しました");
  };

  const remove = (id) => persist({ ...data, calls: data.calls.filter((c) => c.id !== id) });
  const updateCall = (id, patch) => {
    persist({ ...data, calls: data.calls.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const sorted = [...data.calls].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="tab-panel">
      <section className="panel form-panel">
        <h2>コール数入力</h2>
        <div className="form-row">
          <label>営業</label>
          <select value={rep} onChange={(e) => setRep(e.target.value)}>
            {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>日付</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onClick={openPicker} />
        </div>
        <div className="form-row">
          <label>コール数</label>
          <input type="number" min="0" value={count} onChange={(e) => setCount(e.target.value)} placeholder="例）80" />
        </div>
        <div className="form-row">
          <label>決済者数</label>
          <input type="number" min="0" value={decisionMakers} onChange={(e) => setDecisionMakers(e.target.value)} placeholder="例）10" />
        </div>
        <div className="form-row">
          <label>日程切り</label>
          <input type="number" min="0" value={scheduleSet} onChange={(e) => setScheduleSet(e.target.value)} placeholder="例）3" />
        </div>
        <button className="primary-btn" onClick={add}>登録する</button>
      </section>

      <section className="panel">
        <h2>入力履歴<span className="hint">(表内をクリックして直接修正できます)</span></h2>
        <div className="table-wrap">
          <table className="score-table deals-table">
            <thead><tr><th>日付</th><th>営業</th><th>コール数</th><th>決済者数</th><th>日程切り</th><th></th></tr></thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input type="date" value={c.date} onChange={(e) => updateCall(c.id, { date: e.target.value })} onClick={openPicker} />
                  </td>
                  <td>
                    <select value={c.rep} onChange={(e) => updateCall(c.id, { rep: e.target.value })}>
                      {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="number" min="0" className="num-input" value={c.count} onChange={(e) => updateCall(c.id, { count: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min="0" className="num-input" value={c.decisionMakers || 0} onChange={(e) => updateCall(c.id, { decisionMakers: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min="0" className="num-input" value={c.scheduleSet || 0} onChange={(e) => updateCall(c.id, { scheduleSet: Number(e.target.value) })} />
                  </td>
                  <td><button className="text-btn danger" onClick={() => remove(c.id)}>削除</button></td>
                </tr>
              ))}
              {sorted.length === 0 && <tr><td colSpan={6} className="empty-row">入力履歴がありません</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------- Deals Tab (アポ・商談) ----------
function DealsTab({ data, persist, flash }) {
  const [company, setCompany] = useState("");
  const [apoRep, setApoRep] = useState(data.reps[0] || "");
  const [apoDate, setApoDate] = useState(today());
  const [apptDate, setApptDate] = useState("");
  const [product, setProduct] = useState(PRODUCTS[0]);
  const [filterRep, setFilterRep] = useState("すべて");
  const [filterProduct, setFilterProduct] = useState("すべて");

  const addDeal = () => {
    if (!company.trim()) return flash("企業名を入力してください");
    if (!apoRep) return flash("アポ獲得者を選択してください");
    const deal = {
      id: uid(), company: company.trim(), apoRep, apoDate, apptDate, product,
      meetingRep: apoRep,
      status: STATUS.NOT_HANDLED, lossReason: "",
    };
    persist({ ...data, deals: [deal, ...data.deals] });
    setCompany("");
    setApptDate("");
    flash("アポを登録しました");
  };

  const updateDeal = (id, patch) => {
    persist({ ...data, deals: data.deals.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  };

  const removeDeal = (id) => persist({ ...data, deals: data.deals.filter((d) => d.id !== id) });

  const visible = data.deals
    .filter((d) => filterRep === "すべて" || d.apoRep === filterRep || d.meetingRep === filterRep)
    .filter((d) => filterProduct === "すべて" || (d.product || PRODUCTS[0]) === filterProduct)
    .sort((a, b) => (a.apoDate < b.apoDate ? 1 : -1));

  return (
    <div className="tab-panel">
      <section className="panel form-panel">
        <h2>アポ登録</h2>
        <div className="form-row">
          <label>企業名</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="例）株式会社サンプル" />
        </div>
        <div className="form-row">
          <label>アポ獲得者</label>
          <select value={apoRep} onChange={(e) => setApoRep(e.target.value)}>
            {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>商材</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>アポ獲得日</label>
          <input type="date" value={apoDate} onChange={(e) => setApoDate(e.target.value)} onClick={openPicker} />
        </div>
        <div className="form-row">
          <label>アポイント日</label>
          <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} onClick={openPicker} />
        </div>
        <button className="primary-btn" onClick={addDeal}>アポを登録する</button>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>アポ・商談一覧</h2>
          <div className="filter-group">
            <select value={filterRep} onChange={(e) => setFilterRep(e.target.value)} className="filter-select">
              <option>すべて</option>
              {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} className="filter-select">
              <option>すべて</option>
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="score-table deals-table">
            <thead>
              <tr>
                <th>企業名</th><th>アポ獲得者</th><th>商材</th><th>アポ日</th><th>アポイント日</th>
                <th>結果</th><th>商談担当</th><th>受注P</th>
                <th>失注理由</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const visited = isVisited(d);
                const statusClass =
                  d.status === STATUS.WON ? "status-win" :
                  d.status === STATUS.LOST ? "status-lose" :
                  d.status === STATUS.APO_CANCEL ? "status-cancel" :
                  d.status === STATUS.REVISIT ? "status-revisit" : "";
                return (
                  <tr key={d.id}>
                    <td>
                      <input
                        className="company-input"
                        value={d.company}
                        onChange={(e) => updateDeal(d.id, { company: e.target.value })}
                      />
                    </td>
                    <td>
                      <select value={d.apoRep} onChange={(e) => updateDeal(d.id, { apoRep: e.target.value })}>
                        {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={d.product || PRODUCTS[0]} onChange={(e) => updateDeal(d.id, { product: e.target.value })}>
                        {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        value={d.apoDate}
                        onChange={(e) => updateDeal(d.id, { apoDate: e.target.value })}
                        onClick={openPicker}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={d.apptDate || ""}
                        onChange={(e) => updateDeal(d.id, { apptDate: e.target.value })}
                        onClick={openPicker}
                      />
                    </td>
                    <td>
                      <select
                        value={d.status}
                        onChange={(e) => {
                          const status = e.target.value;
                          const nowVisited = status === STATUS.REVISIT || status === STATUS.WON || status === STATUS.LOST;
                          updateDeal(d.id, {
                            status,
                            apptDate: nowVisited ? (d.apptDate || today()) : d.apptDate,
                            meetingRep: nowVisited ? (d.meetingRep || d.apoRep) : d.apoRep,
                            lossReason: status === STATUS.LOST ? d.lossReason : "",
                            wonPoints: status === STATUS.WON ? d.wonPoints : "",
                          });
                        }}
                        className={statusClass}
                      >
                        {RESULT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={d.meetingRep}
                        disabled={!visited}
                        onChange={(e) => updateDeal(d.id, { meetingRep: e.target.value })}
                      >
                        {data.reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      {d.status === STATUS.WON ? (
                        <input
                          type="number"
                          min="0"
                          className="num-input"
                          value={d.wonPoints || ""}
                          onChange={(e) => updateDeal(d.id, { wonPoints: e.target.value })}
                          placeholder="例）10"
                        />
                      ) : <span className="dim">—</span>}
                    </td>
                    <td>
                      {d.status === STATUS.LOST ? (
                        <select value={d.lossReason} onChange={(e) => updateDeal(d.id, { lossReason: e.target.value })}>
                          <option value="">選択</option>
                          {LOSS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : <span className="dim">—</span>}
                    </td>
                    <td><button className="text-btn danger" onClick={() => removeDeal(d.id)}>削除</button></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={10} className="empty-row">該当するアポがありません</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------- Reps Tab ----------
function RepsTab({ data, persist, flash }) {
  const [name, setName] = useState("");

  const add = () => {
    const n = name.trim();
    if (!n) return flash("名前を入力してください");
    if (data.reps.includes(n)) return flash("すでに登録されています");
    persist({ ...data, reps: [...data.reps, n] });
    setName("");
  };

  const remove = (n) => {
    const inUse = data.calls.some((c) => c.rep === n) || data.deals.some((d) => d.apoRep === n || d.meetingRep === n);
    if (inUse && !window.confirm(`${n} には登録済みデータがあります。削除しますか？（データ自体は残ります）`)) return;
    persist({ ...data, reps: data.reps.filter((r) => r !== n) });
  };

  const rename = (oldName, newName) => {
    const n = newName.trim();
    if (!n || n === oldName) return;
    if (data.reps.includes(n)) return flash("すでに登録されている名前です");
    persist({
      reps: data.reps.map((r) => (r === oldName ? n : r)),
      calls: data.calls.map((c) => (c.rep === oldName ? { ...c, rep: n } : c)),
      deals: data.deals.map((d) => ({
        ...d,
        apoRep: d.apoRep === oldName ? n : d.apoRep,
        meetingRep: d.meetingRep === oldName ? n : d.meetingRep,
      })),
    });
    flash("氏名を修正しました");
  };

  return (
    <div className="tab-panel">
      <section className="panel form-panel">
        <h2>営業メンバー登録</h2>
        <div className="form-row">
          <label>氏名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例）田中" onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <button className="primary-btn" onClick={add}>追加する</button>
      </section>

      <section className="panel">
        <h2>メンバー一覧<span className="hint">(名前をクリックして修正できます)</span></h2>
        <ul className="rep-list">
          {data.reps.map((r) => (
            <li key={r}>
              <input
                className="rep-name-input"
                defaultValue={r}
                onBlur={(e) => rename(r, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              />
              <button className="text-btn danger" onClick={() => remove(r)}>削除</button>
            </li>
          ))}
          {data.reps.length === 0 && <li className="empty-row">メンバーが登録されていません</li>}
        </ul>
      </section>
    </div>
  );
}

// ---------- Data Migration Tab ----------
function DataTab({ data, persist, flash }) {
  const [importText, setImportText] = useState("");
  const exportText = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      flash("コピーしました");
    } catch (e) {
      flash("コピーに失敗しました。手動で選択してコピーしてください");
    }
  };

  const runImport = () => {
    if (!importText.trim()) return flash("貼り付ける内容がありません");
    let parsed;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      return flash("JSONの形式が正しくありません");
    }
    if (!window.confirm("現在のデータを、貼り付けた内容で上書きします。よろしいですか？")) return;
    persist({
      reps: parsed.reps || [],
      calls: parsed.calls || [],
      deals: parsed.deals || [],
      strategy: parsed.strategy || { monthly: {}, weekly: {} },
    });
    setImportText("");
    flash("取り込みました");
  };

  return (
    <div className="tab-panel">
      <section className="panel">
        <h2>エクスポート（今のデータを書き出す）</h2>
        <p className="data-note">下のテキストを全部コピーして、移行先に貼り付けてください。</p>
        <textarea className="data-textarea" readOnly value={exportText} onFocus={(e) => e.target.select()} />
        <button className="primary-btn" onClick={copyExport}>コピーする</button>
      </section>

      <section className="panel">
        <h2>インポート（データを取り込む）</h2>
        <p className="data-note">エクスポートした内容を下に貼り付けて取り込みます。今のデータは上書きされます。</p>
        <textarea
          className="data-textarea"
          placeholder="ここに貼り付け"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <button className="primary-btn" onClick={runImport}>この内容を取り込む</button>
      </section>
    </div>
  );
}

// ---------- Styles ----------
function StyleBlock() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');

      :root {
        --bg: #F7F4EE;
        --panel: #FFFFFF;
        --panel-2: #F1ECE2;
        --line: #E5DFD2;
        --ink: #3A362F;
        --ink-dim: #96897A;
        --amber: #C6996A;
        --win: #7FA98A;
        --lose: #C77B6E;
      }
      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      .board-root {
        font-family: 'Noto Sans JP', sans-serif;
        background: var(--bg);
        color: var(--ink);
        min-height: 100vh;
        overflow: hidden;
      }
      .conn-banner {
        background: #F3DFC9; color: #7A5A2E; font-size: 13px; padding: 10px 20px;
        border-bottom: 1px solid #E6C79E;
      }
      .board-header {
        display: flex; align-items: flex-end; justify-content: space-between;
        padding: 22px 28px 16px; border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, #FBF9F4 0%, #F7F4EE 100%);
      }
      .header-eyebrow {
        font-family: 'Oswald', sans-serif; letter-spacing: 0.14em; font-size: 12px;
        color: var(--amber); font-weight: 600;
      }
      .board-header h1 { margin: 4px 0 0; font-size: 22px; font-weight: 700; }
      .header-note { font-size: 12px; color: var(--ink-dim); }
      .board-body { display: flex; min-height: calc(100vh - 90px); }
      .board-nav {
        width: 168px; flex-shrink: 0; padding: 18px 10px; display: flex; flex-direction: column; gap: 4px;
        border-right: 1px solid var(--line); background: #F1ECE2;
      }
      .nav-btn {
        text-align: left; background: transparent; border: none; color: var(--ink-dim);
        padding: 10px 12px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit;
      }
      .nav-btn:hover { background: #EAE3D6; color: var(--ink); }
      .nav-btn.active { background: var(--panel-2); color: var(--amber); font-weight: 700; }
      .board-main { flex: 1; padding: 22px 26px; overflow-x: auto; }
      .tab-panel { display: flex; flex-direction: column; gap: 20px; }

      .kpi-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
      .kpi-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
      .kpi-value { font-family: 'Oswald', sans-serif; font-size: 30px; font-weight: 600; }
      .kpi-label { font-size: 12px; color: var(--ink-dim); margin-top: 2px; }
      .kpi-win .kpi-value { color: var(--win); }
      .kpi-lose .kpi-value { color: var(--lose); }

      .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
      .panel h2 { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
      .panel-head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .panel-head-row h2 { margin: 0; }
      .month-head { margin-bottom: 4px; }
      .month-heading { font-size: 18px; }
      .period-controls { display: flex; align-items: center; gap: 8px; }
      .period-toggle { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
      .period-toggle-btn {
        background: #FFFFFF; border: none; color: var(--ink-dim); padding: 6px 14px;
        font-size: 13px; font-family: inherit; cursor: pointer;
      }
      .period-toggle-btn + .period-toggle-btn { border-left: 1px solid var(--line); }
      .period-toggle-btn.active { background: var(--amber); color: #FFFFFF; font-weight: 700; }
      .strategy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      .data-note { font-size: 12px; color: var(--ink-dim); margin: 0 0 10px; }
      .data-textarea {
        width: 100%; height: 180px; margin-bottom: 12px; resize: vertical;
        background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 10px; font-family: monospace; font-size: 12px;
      }
      .strategy-col-title { font-size: 12px; font-weight: 700; color: var(--ink-dim); margin-bottom: 8px; }
      .strategy-input {
        display: block; width: 100%; margin-bottom: 8px;
        background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 13px;
      }
      @media (max-width: 640px) {
        .strategy-grid { grid-template-columns: 1fr; }
      }

      .table-wrap { overflow-x: auto; }
      .score-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
      .score-table th {
        text-align: left; color: var(--ink-dim); font-weight: 500; font-size: 12px;
        border-bottom: 1px solid var(--line); padding: 8px 10px; white-space: nowrap;
      }
      .score-table td { padding: 9px 10px; border-bottom: 1px solid #EFEAE0; white-space: nowrap; }
      .score-table .rep-cell { font-weight: 700; }
      .score-table .num { font-family: 'Oswald', sans-serif; }
      .score-table .accent { color: var(--amber); }
      .score-table .win { color: var(--win); }
      .score-table .sub { font-family: 'Noto Sans JP'; color: var(--ink-dim); font-size: 11px; }
      .empty-row { text-align: center; color: var(--ink-dim); padding: 20px !important; }

      .deals-table select, .deals-table input[type="date"] {
        background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 4px 6px; font-size: 12px; font-family: inherit;
      }
      .deals-table .company-input {
        background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 4px 6px; font-size: 12px; font-family: inherit;
        width: 140px;
      }
      .deals-table .num-input {
        background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 4px 6px; font-size: 12px; font-family: inherit;
        width: 64px;
      }
      .panel h2 .hint { font-size: 11px; font-weight: 400; color: var(--ink-dim); margin-left: 8px; }
      input[type="date"] {
        color-scheme: light;
        position: relative;
      }
      input[type="date"]::-webkit-calendar-picker-indicator {
        filter: invert(58%) sepia(24%) saturate(750%) hue-rotate(346deg) brightness(95%);
        opacity: 1;
        cursor: pointer;
        padding: 2px;
        margin-left: 6px;
      }
      input[type="date"]::-webkit-inner-spin-button { display: none; }
      .deals-table select.status-win {
        background: #C0392B; color: #FFFFFF; border-color: #C0392B; font-weight: 700;
      }
      .deals-table select.status-lose {
        background: #DCC2A0; color: #4A3620; font-weight: 700;
      }
      .deals-table select.status-cancel {
        background: #D2CDC2; color: #45413A; font-weight: 700;
      }
      .deals-table select.status-revisit {
        background: var(--amber); color: #FFFFFF; border-color: var(--amber);
      }
      .dim { color: var(--ink-dim); }
      .filter-select { background: #FBF9F4; border: 1px solid var(--line); color: var(--ink); border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 13px; }
      .filter-group { display: flex; gap: 8px; }

      .form-panel { max-width: 420px; }
      .form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .form-row label { width: 96px; flex-shrink: 0; font-size: 13px; color: var(--ink-dim); }
      .form-row input, .form-row select {
        flex: 1; background: #FBF9F4; border: 1px solid var(--line); color: var(--ink);
        border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 14px;
      }
      .form-row input[type="date"] { cursor: pointer; }
      .primary-btn {
        background: var(--amber); color: #FFFFFF; border: none; border-radius: 6px;
        padding: 9px 20px; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit;
      }
      .primary-btn:hover { filter: brightness(1.08); }
      .text-btn { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; }
      .text-btn.danger { color: var(--lose); }

      .product-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
      .product-card { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
      .product-name { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
      .product-rate { font-family: 'Oswald', sans-serif; font-size: 26px; font-weight: 600; color: var(--amber); }
      .product-sub { font-size: 11px; color: var(--ink-dim); margin-top: 4px; }
      .product-rate-label { font-size: 11px; color: var(--ink-dim); font-weight: 400; margin-left: 6px; }
      .product-visit { font-size: 11px; color: var(--ink-dim); margin-top: 6px; }
      .product-points { font-size: 11px; color: var(--amber); margin-top: 6px; font-weight: 700; }

      .reason-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
      .reason-card { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
      .reason-rep { font-weight: 700; margin-bottom: 8px; }
      .reason-empty { color: var(--ink-dim); font-size: 12px; }
      .reason-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
      .reason-rank {
        width: 16px; height: 16px; border-radius: 50%; background: #E5DFD2; color: var(--ink-dim);
        display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0;
      }
      .reason-rank.top { background: var(--lose); color: #fff; }
      .reason-label { flex: 1; }
      .reason-count { color: var(--ink-dim); }

      .rep-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .rep-list li { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--panel-2); border-radius: 6px; font-size: 14px; gap: 10px; }
      .rep-name-input {
        flex: 1; background: transparent; border: 1px solid transparent; color: var(--ink);
        font-family: inherit; font-size: 14px; padding: 4px 6px; border-radius: 4px;
      }
      .rep-name-input:hover, .rep-name-input:focus { border-color: var(--line); background: #FBF9F4; outline: none; }

      .toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: var(--panel-2); border: 1px solid var(--line); color: var(--ink);
        padding: 10px 18px; border-radius: 8px; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
      }

      @media (max-width: 720px) {
        .board-body { flex-direction: column; }
        .board-nav { width: 100%; flex-direction: row; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--line); }
        .kpi-strip { grid-template-columns: repeat(2, 1fr); }
      }
    `}</style>
  );
}
