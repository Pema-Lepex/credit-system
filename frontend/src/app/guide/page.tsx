import type { Metadata } from "next";

import "./guide.css";

/**
 * Public guide at /guide — a friendly, self-contained user manual reachable from the
 * login page (see the "How it works" link on login-form.tsx). It is intentionally
 * outside the (public) route group so it uses only the root layout, giving it the
 * full-width canvas its bespoke "Ledger" identity needs — the constrained (public)
 * layout (logo + max-w-2xl) would crop it.
 *
 * The markup is a trusted static string rendered via dangerouslySetInnerHTML: it's
 * our own content (no user input, no injection surface), and it keeps this large,
 * hand-designed page in one place without a mechanical HTML→JSX conversion. All
 * styling lives in the route-scoped, `.gd`-namespaced guide.css; dark mode follows
 * the app's next-themes `.dark` class automatically.
 */

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The Lepex Credit Manager handbook — why it exists and how shopkeepers use it to track credit and never chase a due date by hand again.",
};

const HANDBOOK = `
<header class="topbar">
  <div class="wrap row">
    <a class="brand" href="/login" aria-label="Lepex Credit Manager">
      <img class="mark" src="/brand-icon.png" alt="" width="30" height="30" />
      <span>Lepex Credit Manager<small>The Handbook</small></span>
    </a>
    <nav class="topnav" aria-label="Sections">
      <a href="#start">Start here</a>
      <a href="#loop">Every day</a>
      <a href="#settle">Getting paid</a>
      <a href="#spend">Money out</a>
      <a href="#know">Where you stand</a>
      <a href="#tour">Everything</a>
      <a class="signin" href="/login">Sign in &rarr;</a>
    </nav>
  </div>
</header>

<main>
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <span class="eyebrow">The credit notebook, reinvented</span>
        <h1 class="hero-title">You know exactly who owes you money. <em>Until you don't.</em></h1>
        <p class="hero-sub">Lepex Credit Manager is the shop ledger that never forgets a name, an amount, or a due date &mdash; and quietly reminds everyone before it slips.</p>
        <div class="hero-meta">
          <span class="chip">For shops &amp; small lenders</span>
          <span class="chip">Not accounting &mdash; credit tracking</span>
          <span class="chip">Works on any phone</span>
        </div>
      </div>

      <aside class="khata" aria-label="Example credit page">
        <div class="khata-head">
          <b>Dorji General Store</b>
          <span>Khata &middot; today</span>
        </div>
        <div class="ledger-row">
          <span class="who">Sonam Dorji</span>
          <span class="what">Rice 5kg &middot; Cooking oil 1L</span>
          <span class="amt">Nu. 450</span>
          <span class="tag"><span class="pill due">Due in 3 days</span></span>
        </div>
        <div class="ledger-row">
          <span class="who">Pema Wangmo</span>
          <span class="what">School supplies</span>
          <span class="amt">Nu. 1,200</span>
          <span class="tag"><span class="pill paid">Paid</span></span>
        </div>
        <div class="ledger-row">
          <span class="who">Tashi Namgay</span>
          <span class="what">Phone screen repair</span>
          <span class="amt">Nu. 800</span>
          <span class="tag"><span class="pill overdue">Overdue</span></span>
        </div>
      </aside>
    </div>
  </section>

  <section id="why">
    <div class="wrap measure">
      <span class="sec-label">Why this exists</span>
      <h2>Every shop runs on trust. Trust runs on a notebook.</h2>
      <p class="lead">In thousands of shops, caf&eacute;s, pharmacies and repair corners, business happens on two words: <em>&ldquo;pay later.&rdquo;</em> Someone takes the rice today and settles on payday. It's how neighbourhoods work.</p>
      <p>The trouble isn't the trust &mdash; it's the <strong>notebook</strong>. Pages get wet. Handwriting fades. You forget who promised what, and by when. Chasing a payment feels awkward, so you let it slide&hellip; and slide&hellip; and one day the notebook owes you more than you can remember.</p>
      <div class="thesis">A shopkeeper's memory is worth money. Lepex simply refuses to let that money be <em>forgotten.</em></div>
      <p>That's the whole idea. Not spreadsheets. Not accounting degrees. Just your ledger &mdash; but one that adds up the totals, watches the calendar, and gives everyone a gentle nudge before a due date passes.</p>
    </div>
  </section>

  <section id="idea">
    <div class="wrap measure">
      <span class="sec-label">What it is (and isn't)</span>
      <h2>A credit tracker with a good memory &mdash; not accounting software.</h2>
      <p class="lead">Lepex does four honest things, and does them well:</p>
      <div class="grid" style="margin-top:1.6rem;">
        <div class="card">
          <span class="ref">Job 01 &middot; Record</span>
          <h3>Write down the credit</h3>
          <p>Who took what, how much they still owe, and when it's due. One tidy entry instead of a scribbled line.</p>
        </div>
        <div class="card">
          <span class="ref">Job 02 &middot; Remind</span>
          <h3>Nudge before it's late</h3>
          <p>An email reaches you <em>and</em> your customer a few days before the due date. No more awkward chasing.</p>
        </div>
        <div class="card">
          <span class="ref">Job 03 &middot; Reconcile</span>
          <h3>Take the money</h3>
          <p>One number per customer: what they owe you, right now. They hand you cash, you type the amount, and everything underneath sorts itself out.</p>
        </div>
        <div class="card">
          <span class="ref">Job 04 &middot; Money out</span>
          <h3>What the shop spends</h3>
          <p>Rent, stock, fuel, wages. Write them down once and the app can finally answer the question the notebook never could: <em>did I actually make anything this month?</em></p>
        </div>
        <div class="card">
          <span class="ref">Not the job</span>
          <h3>It's still not an accountant</h3>
          <p>You get a plain profit figure and a tax summary to hand over &mdash; not double-entry books, VAT returns or balance sheets. Keep your accountant; give them better numbers.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="roles">
    <div class="wrap">
      <div class="measure">
        <span class="sec-label">Who's who</span>
        <h2>Three kinds of people. One shop.</h2>
        <p class="lead">Everyone gets exactly the access their job needs &mdash; nothing scary, nothing extra.</p>
      </div>
      <div class="roles">
        <div class="role">
          <span class="cap">You, mostly</span>
          <h4>Owner</h4>
          <p>Runs the shop. Sees everything, records credits and payments, sets the reminders, invites staff, and downloads reports. This is the seat you'll usually be in.</p>
        </div>
        <div class="role">
          <span class="cap">Your helpers</span>
          <h4>Staff</h4>
          <p>The people at the counter. They add customers and record day-to-day credits and payments &mdash; the everyday work &mdash; without touching your business settings.</p>
        </div>
        <div class="role">
          <span class="cap">The gatekeeper</span>
          <h4>Super Admin</h4>
          <p>The platform's caretaker. Reviews and approves new shops that sign up, and can pause a shop if needed. You'll only meet them once &mdash; at approval.</p>
        </div>
      </div>
      <div class="note">
        <span class="ic">&rsaquo;</span>
        <div><b>The approval gate.</b> When a new shop registers, it starts as <span class="pill due" style="margin:0 .15rem;">Pending</span> until the Super Admin approves it. You can sign in and look around, but the ledger unlocks the moment you're approved. It keeps the platform clean and trustworthy for everyone on it.</div>
      </div>
    </div>
  </section>

  <section id="start">
    <div class="wrap measure">
      <span class="sec-label">Your first five minutes</span>
      <h2>From &ldquo;new here&rdquo; to your first credit.</h2>
      <p class="lead">Five steps, in order. You'll be recording real credits before your tea gets cold.</p>
      <div class="steps">
        <div class="step">
          <span class="n">1</span>
          <div>
            <h4>Create your shop</h4>
            <p>Head to <strong>Register</strong>, enter your name, your shop's name and a password. That's your whole sign-up.</p>
          </div>
        </div>
        <div class="step">
          <span class="n">2</span>
          <div>
            <h4>Wait for the green light</h4>
            <p>Your shop sits at <span class="pill due" style="margin:0 .1rem;">Pending</span> while the Super Admin approves it. You'll get in as soon as it's cleared &mdash; usually quick.</p>
          </div>
        </div>
        <div class="step">
          <span class="n">3</span>
          <div>
            <h4>Set up your shop details</h4>
            <p>In <strong>Settings &rarr; Business</strong>, add your logo, phone, address, and &mdash; importantly &mdash; your <strong>currency</strong> and <strong>timezone</strong>, so amounts and due dates read correctly.</p>
          </div>
        </div>
        <div class="step">
          <span class="n">4</span>
          <div>
            <h4>Add your first customer</h4>
            <p>Open <strong>Customers &rarr; New</strong>. A name and a phone number is enough to start. You can add photos and notes later.</p>
          </div>
        </div>
        <div class="step">
          <span class="n">5</span>
          <div>
            <h4>Record your first sale</h4>
            <p>Open the customer, tap <strong>Add sale</strong>, and type the amount. That's it &mdash; no due date to pick, nothing to itemise. Your notebook just went digital.</p>
            <p>Already have a list of customers in a spreadsheet? Skip the typing &mdash; see <a href="#tour">Bring your book with you</a>.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="loop">
    <div class="wrap measure">
      <span class="sec-label">The daily rhythm</span>
      <h2>One page per customer. One number that matters.</h2>
      <p class="lead">A regular doesn't buy once a month &mdash; they buy six times a day. So the app is built around the only question either of you actually asks: <em>how much do I owe you?</em></p>

      <div class="slip">
        <div class="slip-head">
          <b>Sonam Dorji &middot; Account</b>
          <span>Nu. 8,240 owing</span>
        </div>
        <div class="slip-body">
          <div class="slip-line"><span class="lbl">3 Jul &middot; Cigarettes</span><span class="num">Nu. 30</span></div>
          <div class="slip-line"><span class="lbl">3 Jul &middot; Soft drink</span><span class="num">Nu. 25</span></div>
          <div class="slip-line"><span class="lbl">3 Jul &middot; Snacks</span><span class="num">Nu. 60</span></div>
          <div class="slip-line"><span class="lbl">4 Jul &middot; Rice 5kg, cooking oil</span><span class="num">Nu. 670</span></div>
          <div class="slip-line"><span class="lbl">&hellip; and 380 more entries</span><span class="num">&nbsp;</span></div>
          <div class="slip-line"><span class="lbl">1 Aug &middot; Payment &mdash; salary</span><span class="num pos">&minus; Nu. 8,240</span></div>
          <div class="slip-line total"><span>Owing now</span><span class="num">Nu. 0</span></div>
        </div>
      </div>

      <p><strong>1. Open his page.</strong> <strong>Customers &rarr; Sonam Dorji</strong> lands on his <strong>Account</strong>, and the first thing you see is one big number: <em>Nu. 8,240</em>. That's the number to turn the phone around and show him.</p>
      <p><strong>2. He takes a packet of cigarettes.</strong> Tap <strong>Add sale</strong>, type <em>30</em>, save. Under five seconds, one hand, customer still standing there. You can type what it was if you have a moment &mdash; and skip it if you don't.</p>
      <p><strong>3. Do that fifteen times a day.</strong> Every one is a line on his page, with the date and the running balance beside it &mdash; exactly like a bank passbook, because that's the page both of you already know how to read.</p>
      <p><strong>4. Payday.</strong> He hands you Nu. 8,240. Tap <strong>Record payment</strong> &mdash; the amount is already filled in with his full balance &mdash; and save. <em>One tap.</em> Not four hundred.</p>

      <div class="note">
        <span class="ic">&rsaquo;</span>
        <div>You are never asked <em>which</em> purchase the money is for. Nobody knows, and nobody needs to &mdash; he paid down what he owed. The app works out the rest (see <a href="#settle">below</a>).</div>
      </div>
    </div>
  </section>

  <section id="settle">
    <div class="wrap measure">
      <span class="sec-label">How a payment lands</span>
      <h2>Money fills the oldest debt first.</h2>
      <p class="lead">When someone pays part of what they owe, the app settles their <strong>oldest</strong> purchases first &mdash; the same thing you'd do with cash on a counter, working down the page from the top.</p>

      <div class="slip">
        <div class="slip-head">
          <b>Customer A pays Nu. 150</b>
          <span>Oldest first</span>
        </div>
        <div class="slip-body">
          <div class="slip-line"><span class="lbl">Credit 1 &middot; 12 July &middot; Nu. 100</span><span class="tag"><span class="pill paid">Paid</span></span></div>
          <div class="slip-line"><span class="lbl">Credit 2 &middot; 18 July &middot; Nu. 100 &mdash; Nu. 50 still owing</span><span class="tag"><span class="pill due">Partially paid</span></span></div>
          <div class="slip-line total"><span>Owing now</span><span class="num">Nu. 50</span></div>
        </div>
      </div>

      <p>Two Nu. 100 credits, one Nu. 150 payment: the first is <strong>settled in full</strong>, the second is <strong>Nu. 50 short</strong>. You do nothing &mdash; and the Credits list says the same thing as his Account page, immediately.</p>

      <div class="thesis">You never sort out which credit got paid. That's the app's job, and it does it the way you would.</div>

      <p><strong>If you do want to choose</strong>, you still can: open a specific credit and use <strong>Record payment</strong> there. Money aimed at one credit stays on it, and only what's left over flows down the page. Your choice always wins.</p>
      <p><strong>If they pay too much</strong>, the extra isn't lost &mdash; their balance simply goes into credit, and it counts against whatever they buy next. Handing over a round Nu. 10,000 against Nu. 9,880 owing is normal, so the app treats it as normal.</p>
      <p><strong>If they pay early</strong>, nothing gets chased. A credit that's settled before its due date is never reminded about &mdash; you won't send a nudge for money that's already in your drawer.</p>
    </div>
  </section>

  <section id="spend">
    <div class="wrap">
      <div class="measure">
        <span class="sec-label">Money going out</span>
        <h2>The other half of the story.</h2>
        <p class="lead">Knowing what you're owed is only half of it. Write down what you spend and the app can tell you what you actually kept.</p>
      </div>
      <div class="grid">
        <div class="card">
          <span class="ref">Money out &middot; Expenses</span>
          <h3>Write down what you paid</h3>
          <p>Amount, date, who you paid, and a photo of the bill if you have one. Put it in a category &mdash; Rent, Fuel, Wages &mdash; and your reports group themselves. Recording an expense <strong>never</strong> changes what a customer owes you; the two sides stay separate.</p>
          <div class="foot"><span>Snap the receipt</span><span class="val">categories optional</span></div>
        </div>
        <div class="card">
          <span class="ref">Money out &middot; Suppliers</span>
          <h3>The people you pay</h3>
          <p>Your wholesaler, the landlord, the electricity company. Save them once and pick them from a list &mdash; or just type a name for a one-off purchase. Either way the name stays on the expense, even if you remove the supplier later.</p>
          <div class="foot"><span>Saved once</span><span class="val">or type a name</span></div>
        </div>
        <div class="card">
          <span class="ref">Money out &middot; Cash &amp; Bank</span>
          <h3>Where the money sits</h3>
          <p>The cash drawer, your bank account, a mobile wallet. Tell the app which one a payment landed in or an expense came out of, and each balance keeps itself up to date. Nothing to reconcile &mdash; the balance <em>is</em> the movements added up.</p>
          <div class="foot"><span>Always adds up</span><span class="val">no reconciling</span></div>
        </div>
        <div class="card">
          <span class="ref">Money out &middot; Repeating bills</span>
          <h3>The ones that come round</h3>
          <p>Set the rent up once &mdash; amount, day of the month &mdash; and it records itself every month while you sleep. Miss a few days offline and it catches up. It can never charge you twice for the same day, even if it runs twice.</p>
          <div class="foot"><span>Set once</span><span class="val">records itself</span></div>
        </div>
      </div>
    </div>
  </section>

  <section id="know">
    <div class="wrap">
      <div class="measure">
        <span class="sec-label">Where you stand</span>
        <h2>Six answers, one click each.</h2>
        <p class="lead">Every report opens on screen and downloads as <strong>PDF</strong>, <strong>Excel</strong> or <strong>CSV</strong> &mdash; the same numbers either way.</p>
      </div>
      <div class="grid">
        <div class="card">
          <span class="ref">Report</span>
          <h3>Money customers owe</h3>
          <p>Everyone who owes you, worst first, sorted into <em>not due yet</em>, <em>1&ndash;30 days</em>, <em>31&ndash;60</em>, <em>61&ndash;90</em> and <em>90+</em>. This is the one to open on a slow morning &mdash; it tells you exactly who to ring, in order.</p>
        </div>
        <div class="card">
          <span class="ref">Report</span>
          <h3>Profit &amp; loss</h3>
          <p>What you collected, less what your stock cost, less your expenses &mdash; and what's left. In plain words, not accounting ones. Marked <strong>cash basis</strong>, because it counts money you actually took, not money you're owed.</p>
        </div>
        <div class="card">
          <span class="ref">Report</span>
          <h3>Cash flow</h3>
          <p>Money in against money out, day by day, week by week or month by month, with the running difference. The quickest way to see a bad month coming.</p>
        </div>
        <div class="card">
          <span class="ref">Report</span>
          <h3>Where the money went</h3>
          <p>Your spending grouped by category, by supplier and by how you paid. Usually one line explains most of the month.</p>
        </div>
        <div class="card">
          <span class="ref">Report</span>
          <h3>Tax summary</h3>
          <p>What you charged in tax, grouped by rate, ready to hand over. A summary to help you file &mdash; not a return.</p>
        </div>
        <div class="card">
          <span class="ref">Report</span>
          <h3>The daily report</h3>
          <p>Credit issued and collected over any period, with your top customers and how they paid. The original report, still where it was.</p>
        </div>
      </div>
      <div class="note">
        <span class="ic">&rsaquo;</span>
        <div><b>Your dashboard already knows.</b> Today's sales, today's collections, today's expenses and what you're owed sit at the top of the home page &mdash; with this month's profit just under them. You only need the reports when you want the detail behind a number.</div>
      </div>
    </div>
  </section>

  <section id="tour">
    <div class="wrap">
      <div class="measure">
        <span class="sec-label">Everything you can do</span>
        <h2>The full shelf &mdash; in plain language.</h2>
        <p class="lead">Every part of Lepex, and the one job it's there to do for you.</p>
      </div>
      <div class="grid">

        <div class="card">
          <span class="ref">Ledger &middot; Customers</span>
          <h3>Your people</h3>
          <p>A card for everyone who buys on credit &mdash; name, phone, photo, notes, even an emergency contact. Each one carries a private <em>credit score</em> so you can see, at a glance, who always pays and who needs a nudge.</p>
          <div class="foot"><span>Stored once, never repeated</span><span class="val">1 tap to call</span></div>
        </div>

        <div class="card">
          <span class="ref">Ledger &middot; Account</span>
          <h3>What they owe, right now</h3>
          <p>Every customer has an <strong>Account</strong> page: one big balance, and underneath it their whole history &mdash; every purchase, every payment, and the running total after each one, like a bank passbook. <strong>Add sale</strong> and <strong>Record payment</strong> both live here, because this is the page you'll actually live on.</p>
          <div class="foot"><span>Add sale &middot; Record payment</span><span class="val">one number</span></div>
        </div>

        <div class="card">
          <span class="ref">Ledger &middot; Credits</span>
          <h3>The heart of it</h3>
          <p>Every &ldquo;pay later&rdquo; as one clean record: items, quantities, discount, tax, grand total, amount paid, remaining, due date, and a photo of the goods or invoice if you like. Status keeps itself honest &mdash; Pending, Partially paid, Paid, or Overdue &mdash; and updates the moment a payment lands, whether or not it named this credit.</p>
          <div class="foot"><span>Auto-numbered</span><span class="val">CR-2026-0042</span></div>
        </div>

        <div class="card">
          <span class="ref">Ledger &middot; Payments</span>
          <h3>Money coming back</h3>
          <p>Take a payment against the whole account &mdash; the usual way &mdash; or against one specific credit if you want to choose. Either way the amount, date, method and reference are kept forever, and every balance in the app moves with it. No more &ldquo;did he pay that or not?&rdquo;</p>
          <div class="foot"><span>Every payment kept</span><span class="val">oldest settled first</span></div>
        </div>

        <div class="card">
          <span class="ref">Money out &middot; Expenses</span>
          <h3>What the shop spends</h3>
          <p>Every payment out, with a category, a supplier and the receipt. Feeds your profit, cash flow and spending reports &mdash; and never touches what customers owe. See <a href="#spend">Money going out</a>.</p>
          <div class="foot"><span>Rent &middot; stock &middot; fuel</span><span class="val">import supported</span></div>
        </div>

        <div class="card">
          <span class="ref">Money out &middot; Repeating bills</span>
          <h3>Bills that record themselves</h3>
          <p>Rent on the 1st, wages on the 28th. Set the amount and the day once; the app writes the expense each time it falls due, catches up if it was offline, and can never record the same day twice.</p>
          <div class="foot"><span>Set once</span><span class="val">pause any time</span></div>
        </div>

        <div class="card">
          <span class="ref">Ledger &middot; Catalogue</span>
          <h3>Products &amp; Services</h3>
          <p>Keep a list of what you sell &mdash; with price, SKU, barcode, category and stock &mdash; plus the services you offer and their rates. Building a credit then becomes point-and-add instead of typing it all out. Got a long list already? Bring it in from a spreadsheet.</p>
          <div class="foot"><span>Reusable line items</span><span class="val">faster entry</span></div>
        </div>

        <div class="card">
          <span class="ref">Ledger &middot; Import</span>
          <h3>Bring your book with you</h3>
          <p>Years of names already typed into Excel? Download a <strong>template</strong> &mdash; it comes with the right headings and a page of notes &mdash; fill it in, and upload. Works for <strong>customers, credits, products and services</strong>.</p>
          <p>Nothing is saved until you've seen it: every file is checked first and any problem is shown against the row and column you'd see in Excel. If one row is wrong, <em>nothing</em> goes in &mdash; so you're never left guessing which half landed.</p>
          <div class="foot"><span>Excel &middot; CSV</span><span class="val">checked before saving</span></div>
        </div>

        <div class="card">
          <span class="ref">Insight &middot; Dashboard</span>
          <h3>Your shop at a glance</h3>
          <p>The numbers that matter on one screen &mdash; total owed to you, today's due, overdue, this month's collections &mdash; with charts of your trends, your top customers, and the due dates coming up next.</p>
          <div class="foot"><span>Opens on this</span><span class="val">what needs you, first</span></div>
        </div>

        <div class="card">
          <span class="ref">Insight &middot; Reports</span>
          <h3>Take it with you</h3>
          <p>Generate a report for any day, week, month or year and download it as <strong>CSV, Excel, PDF or JSON</strong> &mdash; or hit <strong>View</strong> to open it right in your browser first. Perfect for your records, your accountant, or a quiet Sunday review.</p>
          <div class="foot"><span>View &middot; Download</span><span class="val">4 formats</span></div>
        </div>

        <div class="card">
          <span class="ref">Reach &middot; Reminders</span>
          <h3>Nudges on autopilot</h3>
          <p>Choose when reminders go out &mdash; 1, 3 or 7 days before a due date, or your own schedule &mdash; to both you and your customer. Set it once and let the calendar do the chasing. Anything already paid is never chased.</p>
          <div class="foot"><span>Automatic</span><span class="val">by email</span></div>
        </div>

        <div class="card">
          <span class="ref">Reach &middot; WhatsApp</span>
          <h3>The message they'll actually read</h3>
          <p>Tap <strong>WhatsApp</strong> on any credit and your own WhatsApp opens with the reminder already written &mdash; their name, the amount, the date, all filled in from your template. You read it, and <em>you</em> press send.</p>
          <p>It goes from your number, like any other message, so there's nothing to sign up for and nothing to pay. The only catch: it's one tap per customer, and the phone number needs its country code (<span style="font-family:var(--gd-mono);font-size:.85em;">+975&hellip;</span>).</p>
          <div class="foot"><span>Free &middot; no setup</span><span class="val">you press send</span></div>
        </div>

        <div class="card">
          <span class="ref">Reach &middot; Emails</span>
          <h3>Your words, your style</h3>
          <p>Edit the reminder, receipt and welcome emails yourself &mdash; subject, message, colours, your logo and signature. Drop in <span style="font-family:var(--gd-mono);font-size:.85em;">{{customer_name}}</span> or <span style="font-family:var(--gd-mono);font-size:.85em;">{{amount}}</span> and Lepex fills in the rest.</p>
          <div class="foot"><span>No code needed</span><span class="val">fully editable</span></div>
        </div>

        <div class="card">
          <span class="ref">Reach &middot; Notifications</span>
          <h3>Nothing slips by</h3>
          <p>A tidy inbox inside the app &mdash; reminders sent, payments received, emails delivered. Read, unread, archived. The shop's running memory, always a click away.</p>
          <div class="foot"><span>Unread &middot; Read &middot; Archived</span><span class="val">in-app</span></div>
        </div>

        <div class="card">
          <span class="ref">Find &middot; Search &amp; Filters</span>
          <h3>Find it in a second</h3>
          <p>Search by customer, phone, invoice or credit number. Filter your credits by Paid, Pending or Overdue, by date, customer or amount. Even a very full notebook stays instantly searchable.</p>
          <div class="foot"><span>Global search</span><span class="val">&#8984;K</span></div>
        </div>

      </div>
    </div>
  </section>

  <section id="tidy">
    <div class="wrap">
      <div class="measure">
        <span class="sec-label">Keeping your shop tidy</span>
        <h2>The quiet tools that look after your data.</h2>
        <p class="lead">You'll rarely think about these &mdash; which is exactly the point.</p>
      </div>
      <div class="grid">
        <div class="card">
          <span class="ref">Settings &middot; Staff</span>
          <h3>Invite your team</h3>
          <p>Add the people who work your counter as Staff, so the everyday entries aren't all on you &mdash; while your business settings stay yours alone.</p>
        </div>
        <div class="card">
          <span class="ref">Settings &middot; Trash</span>
          <h3>Undo, safely</h3>
          <p>Deleted a credit or payment by mistake? It goes to Trash first, not gone forever. Restore it with a click &mdash; mistakes shouldn't be permanent.</p>
        </div>
        <div class="card">
          <span class="ref">Settings &middot; Data retention</span>
          <h3>Old records, handled</h3>
          <p>Choose how long finished records are kept &mdash; 30, 60, 90 days, or forever. Before anything is ever removed, you're warned and offered a download. Nothing vanishes behind your back.</p>
        </div>
        <div class="card">
          <span class="ref">Settings &middot; Storage</span>
          <h3>See what you're using</h3>
          <p>A clear read-out of your database, images and exports, with one-tap cleanups. Small and fast, even with thousands of records.</p>
        </div>
        <div class="card">
          <span class="ref">Settings &middot; Audit log</span>
          <h3>A record of records</h3>
          <p>Who changed what, and when. Quiet accountability that's there if you ever need to check back.</p>
        </div>
        <div class="card">
          <span class="ref">Settings &middot; Look &amp; feel</span>
          <h3>Make it yours</h3>
          <p>Light or dark theme, your currency, your timezone, your language. Set it once and the whole app speaks your shop's language.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="faq">
    <div class="wrap measure">
      <span class="sec-label">Good to know</span>
      <h2>The questions everyone asks.</h2>
      <div class="faq">
        <details>
          <summary>A customer paid. Which credit does it settle?</summary>
          <p>The <strong>oldest one first</strong>, then the next, until the money runs out &mdash; the same way you'd work down the page yourself. Pay Nu. 150 against two Nu. 100 credits and the first reads <span class="pill paid" style="margin:0 .1rem;">Paid</span>, the second <span class="pill due" style="margin:0 .1rem;">Partially paid</span> with Nu. 50 to go.</p>
          <p>If you'd rather choose, open that credit and use <strong>Record payment</strong> there instead. Money you aim at a credit stays on it, and only the rest flows to the oldest.</p>
        </details>
        <details>
          <summary>Why does the Credits list show &ldquo;Paid&rdquo; when I never touched that credit?</summary>
          <p>Because the customer's payment covered it. You record money against the <em>person</em>, not against a line item &mdash; so the app marks off whatever that money reached. The Credits list, the customer's balance, your dashboard and your reports all read the same thing, always.</p>
        </details>
        <details>
          <summary>What if someone pays more than they owe?</summary>
          <p>Nothing breaks &mdash; their balance simply goes into credit, and it counts against whatever they buy next. Handing over a round Nu. 10,000 against Nu. 9,880 owing is an ordinary Tuesday, so the app treats it as one.</p>
        </details>
        <details>
          <summary>Can I bring in the customers I already have?</summary>
          <p>Yes. Download the template from <strong>Customers &rarr; Import</strong>, fill it in, and upload &mdash; and the same for credits, products, services, suppliers and expenses. Your file is checked before anything is saved, and any problem is pointed at by row and column. If one row is wrong, nothing is saved, so you're never left with half an import.</p>
        </details>
        <details>
          <summary>Can I remind someone on WhatsApp?</summary>
          <p>Yes &mdash; tap <strong>WhatsApp</strong> on a credit and your own WhatsApp opens with the message already written. You check it and press send, so it comes from your number like any other message. It's free, there's nothing to set up, and it's one tap per customer.</p>
        </details>
        <details>
          <summary>Do my customers need to install anything?</summary>
          <p>No. Lepex is for <em>you</em>, the shopkeeper. Your customers only ever receive a friendly reminder &mdash; by email, or on WhatsApp from your own number. There's nothing for them to download, sign up for, or learn.</p>
        </details>
        <details>
          <summary>Does it work on my phone?</summary>
          <p>Yes. Lepex is fully responsive &mdash; the same shop, laptop or phone, at the counter or at home. Nothing to install; it opens in your browser.</p>
        </details>
        <details>
          <summary>Can my staff see everything I can?</summary>
          <p>No. Staff handle the everyday counter work &mdash; customers, credits, payments &mdash; but your business settings, staff list and platform controls stay with you, the Owner.</p>
        </details>
        <details>
          <summary>What if I make a mistake or delete the wrong thing?</summary>
          <p>Deleted credits and payments go to <strong>Trash</strong> first, so you can restore them. And the <strong>Audit log</strong> keeps a record of changes. It's built to forgive slips.</p>
        </details>
        <details>
          <summary>Is this accounting software?</summary>
          <p>Not quite &mdash; and that's on purpose. It <em>will</em> tell you what you collected, what you spent, and what you kept, and it will hand you a tax summary. What it won't do is double-entry books, VAT returns or balance sheets.</p>
          <p>Think of it as keeping such good records that your accountant's job gets easier &mdash; not as replacing them.</p>
        </details>
        <details>
          <summary>Do I have to record my expenses?</summary>
          <p>No. Everything about credit works exactly as before if you never touch them. But the profit figure can only be as honest as what you've told it &mdash; with no expenses recorded, it will show you your collections and nothing taken off.</p>
        </details>
        <details>
          <summary>Will recording an expense change what someone owes me?</summary>
          <p>Never. Money out and money owed are kept completely apart. Nothing you do on the expenses side can move a customer's balance.</p>
        </details>
        <details>
          <summary>I already have months of expenses in a spreadsheet.</summary>
          <p>Bring them in &mdash; <strong>Expenses &rarr; Import</strong>. Categories are created as they appear, so you don't have to set anything up first. Your profit and cash flow reports then work from day one instead of from today.</p>
        </details>
        <details>
          <summary>Does the app reduce my stock when someone takes goods on credit?</summary>
          <p>Yes &mdash; if you picked the item from your product list. Free-typed items aren't linked to anything, so they can't move a count. Stock is allowed to go negative on purpose: a stale count should never stop you making a sale.</p>
        </details>
        <details>
          <summary>Why did my new shop start as &ldquo;Pending&rdquo;?</summary>
          <p>Every new shop is reviewed and approved by the platform's Super Admin before its ledger unlocks. It keeps the platform trustworthy for every shop on it. You can sign in and look around while you wait.</p>
        </details>
        <details>
          <summary>Is my data safe?</summary>
          <p>Your sign-in is protected, every shop's data is kept separate from every other shop's, and finished records are only ever removed after you're warned and offered a download. Your ledger is yours.</p>
        </details>
      </div>
    </div>
  </section>
</main>

<footer class="gd-footer">
  <div class="wrap">
    <p class="foot-thesis">Your shop's memory, <em>finally</em> written in ink that doesn't fade.</p>
    <div class="foot-meta">
      <span>Lepex Credit Manager</span>
      <a href="#start">Start here</a>
      <a href="#settle">Getting paid</a>
      <a href="#spend">Money out</a>
      <a href="#know">Where you stand</a>
      <a href="#tour">Everything</a>
      <a href="/login">Sign in</a>
      <span class="foot-cta">Built for shopkeepers, not accountants.</span>
    </div>
  </div>
</footer>
`;

export default function GuidePage() {
  return <div className="gd" dangerouslySetInnerHTML={{ __html: HANDBOOK }} />;
}
