import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { RefreshCw, Users, CheckCircle2, Clock, XCircle, CalendarClock } from 'lucide-react';
import { useServices } from '../context/services.context';
import { withTimeout } from '../lib/with-timeout';
import { todayDate, firstOfCurrentMonth, formatDate, formatMonth } from '../lib/datetime';
import { STATUS_LABEL } from '../lib/status';
import type { MemberListRow } from '../types/member-list';
import type { MonthlyCount, PaymentModeTotal, ReportSummary, ReportTransactionRow } from '../types/report';
import type { PaymentMode } from '../types/subscription';
import './ReportsPage.css';

/**
 * Categorical slots 1-3 of the dataviz skill's validated reference palette
 * (`palette.md`) — this app has no multi-hue categorical set of its own, only a
 * single brand hue + status colors, so the reference instance is used as-is per the
 * skill's own guidance. Validated via `validate_palette.js`: PASS on lightness,
 * chroma, CVD separation (worst adjacent ΔE 17.6), and the normal-vision floor
 * (worst adjacent ΔE 29.0); WARN on contrast for Card (#e87ba4, 2.69:1) — mitigated
 * below by always-visible legend text (mode/amount/%), never color alone.
 */
const PAYMENT_MODE_COLOR: Record<PaymentMode, string> = {
  Cash: '#2a78d6',
  UPI: '#008300',
  Card: '#e87ba4',
};

function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

const FETCH_TIMEOUT_MS = 10000;
type LoadState = 'loading' | 'loaded' | 'network-error' | 'generic-error';

function toLoadState(err: unknown, timeoutMessage: string): LoadState {
  const isNetwork = err instanceof Error && (err.message === timeoutMessage || err.message === 'Failed to fetch');
  return isNetwork ? 'network-error' : 'generic-error';
}

export function ReportsPage() {
  const { memberListRepository, reportService } = useServices();

  const [memberRows, setMemberRows] = useState<MemberListRow[]>([]);
  const [staticState, setStaticState] = useState<LoadState>('loading');

  const [startDate, setStartDate] = useState(firstOfCurrentMonth());
  const [endDate, setEndDate] = useState(todayDate());
  const [appliedRange, setAppliedRange] = useState({ start: firstOfCurrentMonth(), end: todayDate() });
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<ReportTransactionRow[]>([]);
  const [rangeState, setRangeState] = useState<LoadState>('loading');

  async function loadStatic() {
    setStaticState('loading');
    try {
      const rows = await withTimeout(memberListRepository.getAll(), FETCH_TIMEOUT_MS, new Error('members-timeout'));
      setMemberRows(rows);
      setStaticState('loaded');
    } catch (err) {
      setStaticState(toLoadState(err, 'members-timeout'));
    }
  }

  async function loadRange(start: string, end: string) {
    setRangeState('loading');
    try {
      const rows = await withTimeout(reportService.getTransactions(start, end), FETCH_TIMEOUT_MS, new Error('report-timeout'));
      setTransactions(rows);
      setRangeState('loaded');
    } catch (err) {
      setRangeState(toLoadState(err, 'report-timeout'));
    }
  }

  useEffect(() => {
    loadStatic();
    loadRange(appliedRange.start, appliedRange.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply(event: FormEvent) {
    event.preventDefault();
    const error = reportService.validateDateRange(startDate, endDate);
    setRangeError(error);
    if (error) return;
    setAppliedRange({ start: startDate, end: endDate });
    loadRange(startDate, endDate);
  }

  const summary: ReportSummary = useMemo(() => reportService.summarize(memberRows), [memberRows, reportService]);
  const expiringRows = useMemo(() => reportService.expiringThisWeek(memberRows), [memberRows, reportService]);

  const subscriptionCounts: MonthlyCount[] = useMemo(
    () => reportService.monthlyCounts(transactions, 'Subscription', appliedRange.start, appliedRange.end),
    [transactions, appliedRange, reportService]
  );
  const addonCounts: MonthlyCount[] = useMemo(
    () => reportService.monthlyCounts(transactions, 'Add-on', appliedRange.start, appliedRange.end),
    [transactions, appliedRange, reportService]
  );
  const sortedTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [transactions]
  );
  const paymentModeTotals = useMemo(() => reportService.paymentModeTotals(transactions), [transactions, reportService]);

  return (
    <div className="reports-page">
      <div className="reports-page-header">
        <h1>Reports</h1>
      </div>

      {/* Static section: summary tiles + Expiring This Week — independent of the date range below. */}
      {staticState === 'loading' && <div className="reports-skeleton" aria-label="Loading" />}

      {(staticState === 'network-error' || staticState === 'generic-error') && (
        <div className="reports-load-error">
          <p>
            {staticState === 'network-error'
              ? "Couldn't load reports — check your connection and try again."
              : 'Something went wrong loading reports. Please try again.'}
          </p>
          <button type="button" className="reports-retry" onClick={loadStatic}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {staticState === 'loaded' && (
        <>
          <div className="reports-tiles">
            <SummaryTile icon={<Users size={20} strokeWidth={2} />} label="Total" value={summary.total} />
            <SummaryTile icon={<CheckCircle2 size={20} strokeWidth={2} />} label="Active" value={summary.active} tone="active" />
            <SummaryTile
              icon={<Clock size={20} strokeWidth={2} />}
              label="Expiring Soon"
              value={summary.expiring}
              tone="expiring"
            />
            <SummaryTile icon={<XCircle size={20} strokeWidth={2} />} label="Expired" value={summary.expired} tone="expired" />
          </div>

          <section className="reports-section">
            <h2 className="reports-section-title">
              <CalendarClock size={18} strokeWidth={2} />
              Expiring This Week
            </h2>
            {expiringRows.length === 0 ? (
              <p className="reports-empty-inline">No memberships expiring this week.</p>
            ) : (
              <div className="reports-expiring-list">
                {expiringRows.map((row) => (
                  <div key={row.id} className="reports-expiring-row">
                    <div>
                      <span className="reports-expiring-name">{row.name}</span>
                      <span className="reports-expiring-plan">{row.current_membership_plan_name}</span>
                    </div>
                    <span className="reports-expiring-badge">
                      {row.current_membership_end_date ? formatDate(row.current_membership_end_date) : STATUS_LABEL.expiring}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Range-scoped section: date picker, charts, transaction list — independent of the section above. */}
      <section className="reports-section">
        <form className="reports-range-form" onSubmit={handleApply}>
          <div className="reports-range-field">
            <label htmlFor="report-start">Start date</label>
            <input id="report-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="reports-range-field">
            <label htmlFor="report-end">End date</label>
            <input id="report-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button type="submit" className="reports-apply">
            Apply
          </button>
        </form>
        {rangeError && <p className="reports-range-error">{rangeError}</p>}
      </section>

      {rangeState === 'loading' && <div className="reports-skeleton" aria-label="Loading" />}

      {(rangeState === 'network-error' || rangeState === 'generic-error') && (
        <div className="reports-load-error">
          <p>
            {rangeState === 'network-error'
              ? "Couldn't load reports — check your connection and try again."
              : 'Something went wrong loading reports. Please try again.'}
          </p>
          <button type="button" className="reports-retry" onClick={() => loadRange(appliedRange.start, appliedRange.end)}>
            <RefreshCw size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {rangeState === 'loaded' && (
        <>
          <div className="reports-charts">
            <BarChart title="New Subscriptions per Month" data={subscriptionCounts} tone="subscription" />
            <BarChart title="New Add-ons per Month" data={addonCounts} tone="addon" />
          </div>

          <PaymentModeChart data={paymentModeTotals} />

          <section className="reports-section">
            <h2 className="reports-section-title">Transactions</h2>
            {sortedTransactions.length === 0 ? (
              <p className="reports-empty-inline">No transactions in this date range.</p>
            ) : (
              <>
                <div className="reports-tx-cards">
                  {sortedTransactions.map((tx) => (
                    <div key={tx.subscription_item_id} className="reports-tx-card">
                      <div className="reports-tx-card-top">
                        <span className="reports-tx-name">{tx.member_name}</span>
                        <span
                          className={`reports-tx-type-badge${tx.transaction_type === 'Add-on' ? ' reports-tx-type-addon' : ''}`}
                        >
                          {tx.transaction_type}
                        </span>
                      </div>
                      <p className="reports-tx-detail">
                        {tx.plan_name} · {formatDate(tx.start_date)}
                      </p>
                      <p className="reports-tx-detail">
                        {tx.member_number} · {tx.phone}
                      </p>
                      <p className="reports-tx-amount">
                        ₹{tx.amount_paid} · {tx.payment_mode}
                      </p>
                    </div>
                  ))}
                </div>

                <table className="reports-tx-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Member #</th>
                      <th>Phone</th>
                      <th>Type</th>
                      <th>Plan</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTransactions.map((tx) => (
                      <tr key={tx.subscription_item_id}>
                        <td>{tx.member_name}</td>
                        <td>{tx.member_number}</td>
                        <td>{tx.phone}</td>
                        <td>
                          <span
                            className={`reports-tx-type-badge${tx.transaction_type === 'Add-on' ? ' reports-tx-type-addon' : ''}`}
                          >
                            {tx.transaction_type}
                          </span>
                        </td>
                        <td>{tx.plan_name}</td>
                        <td>{formatDate(tx.start_date)}</td>
                        <td>₹{tx.amount_paid}</td>
                        <td>{tx.payment_mode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: 'active' | 'expiring' | 'expired';
}) {
  return (
    <div className={`reports-tile${tone ? ` reports-tile-${tone}` : ''}`}>
      <span className="reports-tile-icon">{icon}</span>
      <span className="reports-tile-value">{value}</span>
      <span className="reports-tile-label">{label}</span>
    </div>
  );
}

function BarChart({ title, data, tone }: { title: string; data: MonthlyCount[]; tone: 'subscription' | 'addon' }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="reports-chart">
      <h3 className="reports-chart-title">{title}</h3>
      {data.every((d) => d.count === 0) ? (
        <p className="reports-empty-inline">No data for this range.</p>
      ) : (
        <div className="reports-chart-bars">
          {data.map((d) => (
            <div key={d.month} className="reports-chart-bar-wrap" tabIndex={0} aria-label={`${formatMonth(d.month)}: ${d.count}`}>
              <span className="reports-chart-bar-count">{d.count}</span>
              <div
                className={`reports-chart-bar reports-chart-bar-${tone}`}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
              <span className="reports-chart-bar-label">{formatMonth(d.month)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Revenue by Payment Mode — donut chart, dataviz skill §choosing-a-form "part-to-whole".
 * Fixed 3-slot categorical order (Cash/UPI/Card), never reordered by value. Every value
 * is a permanent direct label in the legend (mode/amount/%) — the ring's hover/focus
 * state and native <title> tooltip enhance, never gate, per §interaction.
 */
function PaymentModeChart({ data }: { data: PaymentModeTotal[] }) {
  const [hovered, setHovered] = useState<PaymentMode | null>(null);
  const total = data.reduce((sum, d) => sum + d.total, 0);

  const r = 70;
  const strokeWidth = 28;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <section className="reports-section">
      <h2 className="reports-section-title">Revenue by Payment Mode</h2>
      {total === 0 ? (
        <p className="reports-empty-inline">No payments in this date range.</p>
      ) : (
        <div className="reports-payment-chart">
          <svg
            viewBox="0 0 200 200"
            className="reports-donut"
            role="img"
            aria-label={`Total revenue ${formatRupees(total)}, split by payment mode`}
          >
            <circle cx="100" cy="100" r={r} fill="none" stroke="var(--color-border-default)" strokeWidth={strokeWidth} />
            <g transform="rotate(-90 100 100)">
              {data.map((d) => {
                if (d.total === 0) return null;
                const segLen = (d.total / total) * circumference;
                const offset = cumulative;
                cumulative += segLen;
                const pct = Math.round((d.total / total) * 100);
                return (
                  <circle
                    key={d.mode}
                    cx="100"
                    cy="100"
                    r={r}
                    fill="none"
                    stroke={PAYMENT_MODE_COLOR[d.mode]}
                    strokeWidth={hovered === d.mode ? strokeWidth + 4 : strokeWidth}
                    strokeDasharray={`${segLen} ${circumference - segLen}`}
                    strokeDashoffset={-offset}
                    tabIndex={0}
                    className="reports-donut-segment"
                    onMouseEnter={() => setHovered(d.mode)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(d.mode)}
                    onBlur={() => setHovered(null)}
                    aria-label={`${d.mode}: ${formatRupees(d.total)}, ${pct}%`}
                  >
                    <title>{`${d.mode}: ${formatRupees(d.total)} (${pct}%)`}</title>
                  </circle>
                );
              })}
            </g>
            <text x="100" y="96" textAnchor="middle" className="reports-donut-total-value">
              {formatRupees(total)}
            </text>
            <text x="100" y="118" textAnchor="middle" className="reports-donut-total-label">
              Total
            </text>
          </svg>

          <ul className="reports-payment-legend">
            {data.map((d) => {
              const pct = total > 0 ? Math.round((d.total / total) * 100) : 0;
              return (
                <li
                  key={d.mode}
                  className={`reports-payment-legend-row${hovered === d.mode ? ' reports-payment-legend-row-active' : ''}`}
                  onMouseEnter={() => setHovered(d.mode)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="reports-payment-legend-swatch" style={{ background: PAYMENT_MODE_COLOR[d.mode] }} aria-hidden="true" />
                  <span className="reports-payment-legend-mode">{d.mode}</span>
                  <span className="reports-payment-legend-amount">{formatRupees(d.total)}</span>
                  <span className="reports-payment-legend-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
