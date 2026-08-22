/**
 * Plain-English explanations for every metric the app shows.
 *
 * Each entry answers three questions in order, because that is the order a
 * person actually asks them: what is this, how do I read the number in front of
 * me, and what would make me wrong to trust it. The `caveat` field is not
 * optional decoration — most of these metrics have a specific way of lying, and
 * a tooltip that omits it is worse than no tooltip.
 */

export interface GlossaryEntry {
  title: string;
  /** What the metric is. */
  what: string;
  /** How to read a value. */
  read: string;
  /** The specific way this metric misleads. */
  caveat?: string;
}

export type GlossaryKey = keyof typeof GLOSSARY;

export const GLOSSARY = {
  // ---------------------------------------------------------------- account
  netLiquidationValue: {
    title: 'Net liquidation value',
    what: 'What the account would be worth if every position were closed at current marks and the cash settled.',
    read: 'This is the headline number for the account — market value of the holdings plus cash.',
    caveat: 'It uses the marks from your last screenshot, not a live feed, so it is as current as that picture.',
  },
  dayPnl: {
    title: 'Day P&L',
    what: 'How much the book has gained or lost today, in dollars and as a percentage of yesterday\'s close.',
    read: 'Driven entirely by price moves in positions you already held — it does not include anything you bought or sold today.',
  },
  unrealizedPnl: {
    title: 'Unrealised P&L',
    what: 'The gain or loss on positions you still hold: current market value minus what you paid.',
    read: 'Positive means the positions are worth more than their cost. Nothing has been banked yet.',
    caveat: 'No tax is owed on an unrealised gain, which is exactly why staging an exit across tax years can matter.',
  },
  realizedPnl: {
    title: 'Realised P&L',
    what: 'Gains and losses that have actually been booked by closing positions.',
    read: 'This is the number that creates a tax event.',
  },
  marketValue: {
    title: 'Market value',
    what: 'What the holdings are worth at current marks, excluding cash.',
    read: 'Net liquidation value minus cash.',
  },
  excessLiquidity: {
    title: 'Excess liquidity',
    what: 'How much cushion the account has above the collateral the broker requires.',
    read: 'The buffer before a margin call becomes possible. Higher is safer.',
    caveat: 'Modelled here as net liquidation value less a 25% maintenance requirement — your broker\'s own figure is authoritative.',
  },
  maintenanceMargin: {
    title: 'Maintenance margin',
    what: 'The minimum equity a broker requires you to keep against the positions.',
    read: 'If equity falls below this, the broker can force liquidation.',
    caveat: 'Modelled at a flat 25% of long market value. Real requirements vary by security and can be raised without notice.',
  },
  buyingPower: {
    title: 'Buying power',
    what: 'How much you could deploy right now, including any margin the broker would extend.',
    read: 'Roughly twice excess liquidity in a standard margin account.',
    caveat: 'Spending it is borrowing. The cash floor in your plan exists partly to stop that.',
  },
  cashFloor: {
    title: 'Cash floor',
    what: 'The minimum share of the account you have decided to keep in cash.',
    read: 'Below the floor, the plan\'s job is to raise cash before it does anything else.',
    caveat: 'A floor only works if it is respected when opportunities look good — which is exactly when it feels most expensive.',
  },
  positionCap: {
    title: 'Position cap',
    what: 'The largest share of the account any single name is allowed to become.',
    read: 'A position over the cap is a concentration decision you made by not deciding.',
  },
  weight: {
    title: 'Position weight',
    what: 'This holding as a percentage of net liquidation value.',
    read: 'How much of your outcome depends on this one name.',
  },

  // -------------------------------------------------------------- valuation
  trailingPe: {
    title: 'Trailing P/E',
    what: 'Share price divided by the last twelve months of earnings per share.',
    read: 'How many years of current earnings you are paying for. Higher means the market expects growth.',
    caveat: 'Backward-looking. A company whose earnings just collapsed will show a very high P/E precisely when it is cheapest, and vice versa.',
  },
  forwardPe: {
    title: 'Forward P/E',
    what: 'Share price divided by expected earnings per share over the next twelve months.',
    read: 'What the market is paying for the earnings analysts expect, rather than the ones already reported.',
    caveat: 'Rests on analyst estimates, which are systematically too optimistic at the start of a cycle and too pessimistic at the end.',
  },
  evEbitda: {
    title: 'EV / EBITDA',
    what: 'Enterprise value — market cap plus debt, minus cash — over earnings before interest, tax, depreciation and amortisation.',
    read: 'The fair comparison for capital-intensive or leveraged businesses, because it prices the debt alongside the equity.',
    caveat: 'EBITDA ignores the cost of maintaining the assets. For a business that must keep spending to stand still, it flatters.',
  },
  priceToSales: {
    title: 'Price / sales',
    what: 'Market capitalisation divided by twelve-month revenue.',
    read: 'The yardstick when earnings are not yet meaningful, because revenue is harder to distort than profit.',
    caveat: 'Says nothing about whether the revenue is profitable. Two companies on the same P/S can have opposite economics.',
  },
  peg: {
    title: 'PEG ratio',
    what: 'The P/E ratio divided by the expected earnings growth rate.',
    read: 'Below 1.0 loosely suggests you are not paying full price for the growth. Above 2.0 suggests you are.',
    caveat: 'Extremely sensitive to the growth estimate in the denominator, which is the least reliable input.',
  },
  valuationBand: {
    title: 'Cheap / fair / expensive',
    what: 'Where the current multiple sits inside this stock\'s own trading history: bottom third reads cheap, top third expensive.',
    read: 'This is a relative statement about one company against its own past, not an absolute claim that it is good value.',
    caveat: 'A business whose prospects have permanently worsened will look "cheap" against its own history all the way down.',
  },
  peerMedian: {
    title: 'Peer median',
    what: 'The middle multiple across a comparable group of companies.',
    read: 'Trading above the peer median means the market thinks this business deserves a premium. Sometimes it does.',
  },
  profitMargin: {
    title: 'Profit margin',
    what: 'Net income as a percentage of revenue — what is left after every cost including tax and interest.',
    read: 'How many cents of every dollar of sales reach the bottom line.',
  },
  operatingMargin: {
    title: 'Operating margin',
    what: 'Operating income as a percentage of revenue, before interest and tax.',
    read: 'The cleanest read on whether the core business itself is profitable, stripped of financing decisions.',
  },
  debtToEquity: {
    title: 'Debt / equity',
    what: 'Total debt divided by shareholder equity.',
    read: 'How much of the business is funded by borrowing rather than by owners. Above about 2.0 is meaningful leverage.',
    caveat: 'Meaningless when equity is negative — which happens after years of buybacks, and does not by itself indicate distress.',
  },
  beta: {
    title: 'Beta',
    what: 'How much this stock has historically moved for a 1% move in the broad market.',
    read: '1.0 moves with the market. 2.0 moves twice as hard in both directions. Below 1.0 dampens.',
    caveat: 'Measured from past correlation, which breaks down in exactly the sharp selloffs you would want it to hold for.',
  },
  shortInterest: {
    title: 'Short interest',
    what: 'The percentage of tradable shares currently sold short.',
    read: 'Above roughly 10% means a meaningful group is betting against the name.',
    caveat: 'Cuts both ways: heavy shorting is a bearish signal and also the fuel for a squeeze.',
  },
  dividendYield: {
    title: 'Dividend yield',
    what: 'Annual dividend per share as a percentage of the share price.',
    read: 'The cash return you receive for holding, before any price change.',
    caveat: 'A yield that looks unusually high is often a falling price rather than a generous payout.',
  },
  analystTarget: {
    title: 'Analyst price target',
    what: 'The average twelve-month price target across covering analysts.',
    read: 'Above the current price implies expected upside. A target below spot is an unusually direct warning.',
    caveat: 'Targets cluster around the current price and get revised after moves, not before them.',
  },
  week52Range: {
    title: '52-week range',
    what: 'The lowest and highest price over the last year.',
    read: 'Context for where the current price sits in its recent history.',
  },

  // -------------------------------------------------------------- technical
  trendScore: {
    title: 'Trend score',
    what: 'Six checks scored out of five: price above each of the 20, 50, 100 and 200-day averages, RSI above 50, and +DI above −DI.',
    read: '5 of 5 means every trend measure agrees the direction is up. Under 2 means they agree it is down.',
    caveat: 'Trend describes what price has done, not what the business is worth. It is a timing input, not a thesis.',
  },
  movingAverage: {
    title: 'Moving average',
    what: 'The average closing price over a window — 20, 50, 100 or 200 trading days.',
    read: 'Price above the average means recent buyers are ahead. The 50 and 200-day are the levels most traders actually watch.',
    caveat: 'Self-fulfilling to a degree, and always late by construction: it is an average of the past.',
  },
  rsi: {
    title: 'RSI',
    what: 'Relative Strength Index — momentum on a 0 to 100 scale, comparing the size of recent gains to recent losses.',
    read: 'Above 70 is conventionally overbought, below 30 oversold. Above 50 simply means upward momentum.',
    caveat: 'A strong stock can stay above 70 for months. Treating it as a sell signal on its own is a way to exit winners early.',
  },
  directionalIndicators: {
    title: '+DI and −DI',
    what: 'Directional indicators: the strength of upward versus downward price movement over 14 days.',
    read: '+DI above −DI means buyers have had the upper hand. The wider the gap, the more decisive.',
  },
  maDistance: {
    title: 'Distance from moving averages',
    what: 'How far the current price sits above or below each moving average, in percent.',
    read: 'A long way above suggests an extended move; below all of them suggests a broken trend.',
  },

  // ----------------------------------------------------------------- quality
  returnOnEquity: {
    title: 'Return on equity',
    what: 'Net income as a percentage of shareholder equity.',
    read: 'How much profit the business generates on the capital owners have in it. Sustained figures above 15% are strong.',
    caveat: 'Leverage inflates it. A heavily indebted company can post excellent ROE and still be fragile.',
  },
  roic: {
    title: 'Return on invested capital',
    what: 'Operating profit after tax as a percentage of all capital in the business, debt included.',
    read: 'The cleanest single measure of business quality, because it is not flattered by borrowing.',
  },
  grossMargin: {
    title: 'Gross margin',
    what: 'Revenue less the direct cost of delivering it, as a percentage of revenue.',
    read: 'High and stable gross margin usually indicates pricing power.',
  },
  fcfMargin: {
    title: 'Free cash flow margin',
    what: 'Cash left after operating costs and capital spending, as a percentage of revenue.',
    read: 'Cash is harder to manipulate than earnings. A wide gap between profit margin and FCF margin is worth understanding.',
  },
  netDebtToEbitda: {
    title: 'Net debt / EBITDA',
    what: 'Debt minus cash, divided by annual EBITDA — roughly how many years of earnings it would take to repay borrowings.',
    read: 'Under 2.0 is comfortable, over 4.0 is stretched. Negative means the company holds more cash than debt.',
  },
  revenueCagr: {
    title: 'Revenue CAGR',
    what: 'The compound annual growth rate of revenue over three years.',
    read: 'Smooths out a single strong or weak quarter to show the underlying trajectory.',
  },
  shareCountChange: {
    title: 'Share count change',
    what: 'The year-on-year change in diluted shares outstanding.',
    read: 'Negative means buybacks — your slice of the company grows without you doing anything. Positive means dilution.',
  },
  ownership: {
    title: 'Ownership',
    what: 'The share of the company held by institutions and by insiders.',
    read: 'High institutional ownership means a well-followed name. Meaningful insider ownership aligns management with holders.',
  },

  // --------------------------------------------------------------- momentum
  momentum: {
    title: 'Momentum',
    what: 'Total price return over each window: one month through one year, plus year to date.',
    read: 'Consistent positive returns across windows indicate a durable trend rather than one good week.',
  },
  fromHigh: {
    title: 'Distance from the 52-week high',
    what: 'How far below its one-year peak the price currently sits.',
    read: 'This is the drawdown you are living through. Deeper than about 20% is a genuine correction in that name.',
  },

  vixCashLevels: {
    title: 'Cash levels by the VIX',
    what: 'A general ladder: the calmer the market, the more cash to hold — VIX under 15 suggests ~25% cash, 15–20 ~20%, 20–30 ~15%, over 30 ~10%.',
    read: 'It is deliberately contrarian. A high VIX means fear is already priced in, and forward returns from fear spikes have historically been better — so that is when cash goes to work. A low VIX is complacency, which is when cash is rebuilt.',
    caveat: 'A regime guide, not a timing signal. VIX spikes cluster — the market can stay panicked and keep falling — and the ladder says nothing about which names to buy. The floor the plan enforces still wins.',
  },

  // ---------------------------------------------------------------- insiders
  insiderActivity: {
    title: 'Insider activity',
    what: 'The net direction of recent open-market filings by the company\'s own officers and directors — buying, selling, or quiet.',
    read: 'Purchases carry more signal than sales: an insider buys for one reason, but sells for many — tax, diversification, a house. A cluster of buys after a fall is the pattern worth noticing.',
    caveat: 'Scheduled 10b5-1 sales and option exercises are routine and say little. The detail line names the filings so you can judge whether the read rests on conviction or on payroll.',
  },

  // -------------------------------------------------------------- sentiment
  sentiment: {
    title: 'News sentiment',
    what: 'The tone of recent coverage and analyst commentary, scored from −1 to +1.',
    read: 'A measure of the story being told about the company right now, not of the company itself.',
    caveat: 'Sentiment follows price at least as often as it leads it. Its use is as context for a move, not a prediction of one.',
  },
  analystRevisions: {
    title: 'Analyst revisions',
    what: 'Changes to price targets and ratings since the last quarter.',
    read: 'The direction of revisions tends to carry more information than the level of the targets.',
  },
  earningsSurprise: {
    title: 'Earnings surprise',
    what: 'Reported earnings per share against what analysts expected, as a percentage.',
    read: 'Positive means a beat. What usually moves the price more is the guidance given alongside it.',
  },

  // -------------------------------------------------------------- portfolio
  concentration: {
    title: 'Concentration',
    what: 'How much of the account depends on its largest positions.',
    read: 'A book where the top five names are most of the value has the return profile of five decisions, not fourteen.',
  },
  hhi: {
    title: 'Effective number of positions',
    what: 'Derived from the Herfindahl index: the number of equally sized positions that would give the same concentration as this book.',
    read: 'Fourteen holdings with an effective count of eight means six of them barely matter to the outcome.',
  },
  portfolioBeta: {
    title: 'Portfolio beta',
    what: 'The weighted average beta of the holdings — how the book as a whole should move with the market.',
    read: 'Above 1.0 means the account amplifies market moves in both directions.',
    caveat: 'Weighted averages hide clustering: a book of high-beta names in one theme is riskier than its beta suggests.',
  },
  breadth: {
    title: 'Breadth',
    what: 'How many holdings share a condition — in an uptrend, cheap against their own history, insiders buying or selling.',
    read: 'Breadth tells you whether something is happening to one position or to the whole book.',
  },
  valuationDispersion: {
    title: 'Valuation dispersion',
    what: 'How spread out the holdings are between cheap and expensive against their own histories.',
    read: 'A book clustered at the expensive end has less room for disappointment across the board.',
  },
  earningsClustering: {
    title: 'Earnings clustering',
    what: 'How many holdings report within the same short window.',
    read: 'Several reports in one week means a concentrated block of event risk on specific dates.',
  },
  cashDrag: {
    title: 'Cash position',
    what: 'Cash as a share of the account, against the floor you set.',
    read: 'Cash is optionality with a cost: it protects on the way down and lags on the way up.',
  },

  // ------------------------------------------------- reported fundamentals
  fundamentals: {
    title: 'Reported fundamentals',
    what: 'The figures the company itself filed each quarter: revenue, operating income, net income and earnings per share.',
    read: 'The shape of the bars matters more than any single one. Steady growth, a step change, or a stall each tell you something different.',
    caveat: 'Quarterly figures are seasonal for many businesses. Compare a quarter with the same quarter last year, not with the one before it.',
  },
  revenue: {
    title: 'Revenue',
    what: 'Total sales for the quarter, before any costs.',
    read: 'The top line. Growth here is the hardest thing for a company to fake and the hardest to manufacture.',
  },
  operatingIncome: {
    title: 'Operating income',
    what: 'Profit from the core business after operating costs, but before interest and tax.',
    read: 'Compare its trajectory with revenue: rising faster means margins are expanding, slower means costs are outrunning sales.',
  },
  netIncome: {
    title: 'Net income',
    what: 'What is left after every cost, including interest, tax and one-off items.',
    read: 'The bottom line, and the number earnings per share is calculated from.',
    caveat: 'The most easily distorted figure on the statement. A single asset sale or writedown can swing it without the business changing at all.',
  },
  eps: {
    title: 'Earnings per share',
    what: 'Net income divided by the number of shares outstanding.',
    read: 'What each share you own earned. This is the number P/E is built on and the one analysts forecast.',
    caveat: 'Buybacks raise EPS without the business earning more, because the same profit is divided among fewer shares.',
  },
  multipleHistory: {
    title: 'Multiple history',
    what: 'What the market has been willing to pay for this company each quarter over the last two and a half years.',
    read: 'The dashed line marks today. Below the range means the market is paying less than it usually has; above means more.',
    caveat: 'Reconstructed from quarter-end prices and trailing results rather than published, because no one publishes a multiple history.',
  },

  // ------------------------------------------------------------- cash flow
  adjustedEbitda: {
    title: 'Adjusted EBITDA',
    what: 'Earnings before interest, tax, depreciation and amortisation, with one-off items stripped out — the number companies lead with.',
    read: 'A view of operating profitability before financing and accounting choices. Most valuation multiples are built on it.',
    caveat: 'It is not cash. It sits above interest, tax, working capital and the capital spending the business needs to keep running — which is exactly what the walk below shows.',
  },
  fcf: {
    title: 'Free cash flow',
    what: 'The cash left after every operating cost, tax, interest payment and capital expenditure — what the business could actually hand to owners.',
    read: 'The number that funds dividends, buybacks and debt repayment. Earnings are an opinion; this is closer to a fact.',
    caveat: 'A company can raise FCF for a year simply by under-investing. Persistently low capex against depreciation is borrowing from the future.',
  },
  fcfConversion: {
    title: 'FCF conversion',
    what: 'Free cash flow as a percentage of adjusted EBITDA.',
    read: 'How much of the headline profitability survives to become cash. Above 60% is strong; below 30% means most of it is being consumed.',
    caveat: 'A low figure is not automatically bad — a business investing heavily into real growth looks identical to one that simply cannot convert. The walk shows you which lines are responsible.',
  },
  capex: {
    title: 'Capital expenditure',
    what: 'Cash spent on property, plant, equipment and other long-lived assets.',
    read: 'Split it mentally into maintenance — what it costs to stand still — and growth. Only the second is optional.',
    caveat: 'Reported as one line, so the split is a judgement. Capex running far above depreciation usually means growth; far below usually means under-investment.',
  },
  stockBasedComp: {
    title: 'Stock-based compensation',
    what: 'Employees paid in shares rather than cash.',
    read: 'Deducted here rather than added back. It is non-cash to the company and very real to you: it is paid in the thing you own.',
    caveat: 'Adjusted EBITDA almost always adds this back, which is why adjusted figures can look far better than the cash ever does.',
  },
  workingCapital: {
    title: 'Working capital',
    what: 'Cash tied up in inventory and unpaid customer invoices, less what the business owes suppliers.',
    read: 'A positive number here means growth consumed cash. Fast-growing businesses often fund their own expansion this way.',
  },
  cashTaxes: {
    title: 'Cash taxes',
    what: 'Tax actually paid, as opposed to the tax expense on the income statement.',
    read: 'Often materially lower than the reported charge because of timing differences and loss carry-forwards.',
  },
  fcfYield: {
    title: 'FCF yield',
    what: 'Free cash flow divided by market capitalisation.',
    read: 'What you would earn in cash terms if the whole business paid out everything it generated. Directly comparable to a bond yield.',
  },

  // ---------------------------------------------------------- Monte Carlo
  monteCarlo: {
    title: 'Monte Carlo projection',
    what: 'Thousands of simulated futures for this portfolio, each drawing random market and company outcomes, then reading off the range of results.',
    read: 'The bands are outcome ranges, not forecasts. The middle line is the median path; nine in ten simulations land inside the outer band.',
    caveat: 'It is only as good as its assumptions, and it models a normal world. Real markets have fatter tails than any of these draws, so the worst 5% shown is optimistic about how bad things can get.',
  },
  singleFactorModel: {
    title: 'How the holdings are linked',
    what: 'Every holding is driven by one shared market factor scaled by its beta, plus its own independent noise.',
    read: 'This is what stops the simulation pretending fourteen positions are fourteen independent bets. They fall together because they share the factor.',
    caveat: 'One factor is a simplification. Two names in the same theme are more correlated than their betas alone imply, so genuine concentration is still under-stated.',
  },
  expectedReturn: {
    title: 'Expected return',
    what: 'The annual return assumed for each holding before any randomness is applied.',
    read: 'Under CAPM it is the risk-free rate plus beta times the equity risk premium — higher-beta names are assumed to earn more because they carry more risk.',
    caveat: 'Switching to analyst targets makes the projection inherit whatever optimism is in those targets. Neither basis is a prediction.',
  },
  volatilityEstimate: {
    title: 'Volatility estimate',
    what: 'How much each holding is assumed to move, estimated from its 52-week range using the Parkinson estimator and floored at its market exposure.',
    read: 'Higher volatility widens that holding\'s contribution to the fan in both directions.',
    caveat: 'A single annual range under-states volatility for a stock that trended steadily rather than swinging, which is why the estimate is never allowed below beta times market volatility.',
  },
  probabilityOfBeating: {
    title: 'Probability of beating the S&P',
    what: 'The share of simulated paths where the portfolio ends above an S&P 500 holding of the same starting value.',
    read: 'Compared path by path, so both experience the same simulated market. A figure near 50% means the book is essentially a market bet with extra variance.',
  },
  valueAtRisk: {
    title: 'Worst 5% outcome',
    what: 'The value below which only one in twenty simulated paths ends up.',
    read: 'A rough floor for planning: bad but not catastrophic. Use it to check the drawdown you would have to sit through is one you could.',
    caveat: 'Says nothing about how bad the remaining 5% gets. Tail losses are worse than this number suggests.',
  },
  equityRiskPremium: {
    title: 'Equity risk premium',
    what: 'The extra annual return equities are assumed to deliver over risk-free government debt.',
    read: 'The single most consequential assumption in the projection. Historically around 4–6%; the default here is 4.5%.',
  },

  // ------------------------------------------------------------- narrative
  verdict: {
    title: 'Verdict',
    what: 'A judgement on what to do with this position: buy, add, hold, trim, sell, or watch.',
    read: 'It is an opinion, formed from the figures on this page and your rebalancing plan. Read the reasoning underneath before acting on the label.',
    caveat: 'Written at a point in time. If the company has reported since, the page says so — the verdict predates the news.',
  },
  thesis: {
    title: 'Thesis',
    what: 'The one-line reason this position exists in the book.',
    read: 'If you cannot state it in a sentence, that is itself information.',
  },
  catalyst: {
    title: 'Catalyst',
    what: 'A specific, identifiable event that could cause the market to reprice the shares.',
    read: 'The more concrete and the more dated, the more useful. "Improving sentiment" is not a catalyst; a contract award is.',
  },
  keyRisk: {
    title: 'Key risk',
    what: 'The thing most likely to make owning this a mistake.',
    read: 'Not every risk — the one that actually threatens the reason you own it.',
  },
  bullBearCase: {
    title: 'Bull and bear case',
    what: 'The strongest honest argument each way, stated without hedging.',
    read: 'Deliberately written as advocacy on both sides. If one of them feels obviously weak to you, that disagreement is worth examining.',
  },
  whatWouldChangeMyMind: {
    title: 'What would change the verdict',
    what: 'A specific, observable thing that would flip the recommendation.',
    read: 'This is the field that keeps a verdict honest. If nothing could change it, it was never a judgement — it was a position.',
  },

  // ------------------------------------------------------------------ plan
  tranche: {
    title: 'Tranche',
    what: 'One instalment of a multi-step plan. This plan runs in three: A, B and C.',
    read: 'Splitting trades across tranches spreads the entry or exit price and, for a sale, can spread the tax event across settlement windows.',
    caveat: 'Staging costs you if the price runs away. It buys certainty about the average, not the best outcome.',
  },
  planLeg: {
    title: 'Plan leg',
    what: 'A single action inside a tranche: buy, sell, exit, hold or defer, with a share count.',
    read: 'Tap to mark it done. The projection above recalculates cash, sector mix and constraint breaches as you do.',
  },
  planProjection: {
    title: 'Projection',
    what: 'What the account would look like if the selected tranche were completed at current marks.',
    read: 'Use it to check the plan gets you back over the cash floor before you trade, not after.',
    caveat: 'Priced at the marks from your last screenshot. Real fills will differ.',
  },

  // ------------------------------------------------------------- portfolio
  attribution: {
    title: 'Attribution',
    what: 'Which positions produced today\'s gain or loss, in dollars and as a share of the total move.',
    read: 'A day that looks flat at the account level can hide two large positions cancelling each other out.',
  },
  sectorTarget: {
    title: 'Target mix',
    what: 'The share of the account you have decided each sector should hold.',
    read: 'The notch on each bar is the target; the bar is where you actually are. The gap is drift.',
  },
  drift: {
    title: 'Drift',
    what: 'How far a sector has moved from its target weight, in percentage points.',
    read: 'Drift accumulates from price moves alone — you can end up overweight something without ever buying more of it.',
  },
  topMovers: {
    title: 'Top movers',
    what: 'The holdings with the largest percentage moves today.',
    read: 'A quick check on whether the day was broad or driven by one or two names.',
  },
  needsAttention: {
    title: 'Needs attention',
    what: 'Constraint breaches, broken trends and insider selling, gathered in one place.',
    read: 'Everything here is derived from thresholds you set. An empty list means nothing crossed one.',
  },
  snapshot: {
    title: 'Snapshot',
    what: 'A daily record of account value, day P&L, and each holding\'s trend score and verdict.',
    read: 'Taken automatically whenever the book is updated. It is what makes the history view possible.',
  },
  watchlistOnly: {
    title: 'Watchlist',
    what: 'A name tracked and analysed but not currently held.',
    read: 'Carries the same analysis as a holding. Position-level figures are blank because there is no position.',
  },

  // ---------------------------------------------------------------- market
  marketIndex: {
    title: 'Market index',
    what: 'A benchmark measuring a broad slice of the market — the S&P 500, Dow and Nasdaq Composite.',
    read: 'Context for whether a move in your book was yours or everyone\'s.',
  },
  treasuryYield: {
    title: 'Treasury yield',
    what: 'The annual return on US government debt at a given maturity.',
    read: 'The risk-free rate everything else is priced against. Rising yields make future earnings worth less today, which pressures high-multiple growth names most.',
  },
  etf: {
    title: 'ETF',
    what: 'An exchange-traded fund: a basket of securities that trades like a single share.',
    read: 'Gives you exposure to a sector without picking a winner inside it.',
    caveat: 'Most sector ETFs are top-heavy — a few large holdings drive most of the move, so the diversification is thinner than the ticker count suggests.',
  },

  // ----------------------------------------------------------- provenance
  dataProvenance: {
    title: 'Where the numbers came from',
    what: 'The source and age of each block of data on this page.',
    read: 'Blocks refresh independently, so live prices can sit beside week-old fundamentals. This is where you check which is which.',
  },
  costBasis: {
    title: 'Average cost',
    what: 'What you paid per share, averaged across every purchase of this position.',
    read: 'The line between an unrealised gain and an unrealised loss.',
  },
  themeOverlap: {
    title: 'Theme overlap',
    what: 'Positions that would move together because they depend on the same underlying driver, regardless of their sector label.',
    read: 'Sector buckets can hide this. Names spread across three sectors can still be one bet.',
  },
} as const satisfies Record<string, GlossaryEntry>;

/**
 * Accessor rather than direct indexing: `as const satisfies` keeps the keys
 * exact but narrows each entry to its literal shape, so `caveat` disappears
 * from the type for entries that do not have one. Widening here once means
 * callers get a uniform `GlossaryEntry`.
 */
export function glossary(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key] as GlossaryEntry;
}
