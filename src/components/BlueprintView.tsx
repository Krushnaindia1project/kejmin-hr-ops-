import React from 'react';

export const BlueprintView: React.FC = () => {
  return (
    <div className="view on" id="v-blue">
      <div className="glass sec" style={{ marginTop: 0 }}>
        <h3>System map — Google Cloud / Firebase</h3>
        <div className="tbl">
          <svg viewBox="0 0 760 330" width="100%" style={{ minWidth: 680 }}>
            <rect className="bx" x="10" y="10" width="740" height="52" rx="12" />
            <text x="30" y="40">
              CLIENT · React/Vite PWA (this UI) · glass design · Web + Mobile · Bengaluru office
              + Plant 1 + Plant 2
            </text>
            <path d="M380 62v28" stroke="#ff8a1f" strokeWidth="2" />
            <rect className="bx bxo" x="10" y="90" width="740" height="52" rx="12" />
            <text x="30" y="120">
              API LAYER · Cloud Run / Firebase Functions · RBAC middleware · Workflow engine ·
              Scoring engine
            </text>
            <path d="M380 142v28" stroke="#ff8a1f" strokeWidth="2" />
            <rect className="bx" x="10" y="170" width="240" height="64" rx="12" />
            <text x="26" y="196">
              Firebase Auth
            </text>
            <g className="m">
              <text x="26" y="216">
                email + role custom claims
              </text>
            </g>
            <rect className="bx" x="260" y="170" width="240" height="64" rx="12" />
            <text x="276" y="196">
              Firestore
            </text>
            <g className="m">
              <text x="276" y="216">
                users · tasks · paths · scores
              </text>
            </g>
            <rect className="bx" x="510" y="170" width="240" height="64" rx="12" />
            <text x="526" y="196">
              Cloud Storage
            </text>
            <g className="m">
              <text x="526" y="216">
                proofs, photos, documents
              </text>
            </g>
            <rect className="bx bxr" x="10" y="250" width="240" height="64" rx="12" />
            <text x="26" y="276">
              Cloud Scheduler + FCM
            </text>
            <g className="m">
              <text x="26" y="296">
                due-date alerts, escalation
              </text>
            </g>
            <rect className="bx bxr" x="260" y="250" width="240" height="64" rx="12" />
            <text x="276" y="276">
              BigQuery + Looker
            </text>
            <g className="m">
              <text x="276" y="296">
                month / FY / custom analytics
              </text>
            </g>
            <rect className="bx bxr" x="510" y="250" width="240" height="64" rx="12" />
            <text x="526" y="276">
              Audit log + Backups
            </text>
            <g className="m">
              <text x="526" y="296">
                immutable history, DR
              </text>
            </g>
          </svg>
        </div>
      </div>

      <div className="glass sec">
        <h3>Role hierarchy (top → bottom)</h3>
        <div className="tbl">
          <svg viewBox="0 0 760 120" width="100%" style={{ minWidth: 680 }}>
            <g>
              <rect className="bx bxr" x="5" y="30" width="110" height="46" rx="10" />
              <text x="20" y="58">
                Developer
              </text>
              <rect className="bx bxo" x="135" y="30" width="110" height="46" rx="10" />
              <text x="152" y="58">
                Owner
              </text>
              <rect className="bx" x="265" y="30" width="110" height="46" rx="10" />
              <text x="278" y="58">
                Finalizer
              </text>
              <rect className="bx" x="395" y="30" width="110" height="46" rx="10" />
              <text x="418" y="58">
                Auditor
              </text>
              <rect className="bx" x="525" y="30" width="110" height="46" rx="10" />
              <text x="535" y="50">
                Process
              </text>
              <text x="535" y="66">
                Coordinator
              </text>
              <rect className="bx bxo" x="655" y="30" width="100" height="46" rx="10" />
              <text x="670" y="58">
                Plant Staff
              </text>
            </g>
            <g stroke="#1456d9" strokeWidth="2">
              <path d="M115 53h20M245 53h20M375 53h20M505 53h20M635 53h20" />
            </g>
          </svg>
        </div>
        <div className="sub">
          Custom roles can be created by Developer/Owner; each role = a set of permissions, branch
          and location scope.
        </div>
      </div>

      <div className="glass sec">
        <h3>Task lifecycle</h3>
        <div className="path" style={{ marginBottom: 12 }}>
          <span className="st d">Created</span>›<span className="st d">Stage 1 · assignee</span>›
          <span className="st c">Stage 2…n · reviewers</span>›
          <span className="st">Final approval</span>›<span className="st">Closed</span>
        </div>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Who can do it</th>
                <th>What the system does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>Create task</b>
                </td>
                <td>Roles with &quot;Create tasks&quot;</td>
                <td>
                  Saves title, branch, location, importance, due date and the process path.
                  Notifies the first assignee.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Mark stage done</b>
                </td>
                <td>The person (or any member of the group) on the current stage</td>
                <td>
                  Moves the task to the next stage, writes a score event, adds a line to the audit
                  log, notifies the next person.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Send back</b>
                </td>
                <td>Auditor, Finalizer, Owner, Developer</td>
                <td>
                  Returns the task one stage, requires a reason, notifies the previous person.
                  Points for the reversed stage are removed.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Final approval</b>
                </td>
                <td>Last person on the path (usually Finalizer)</td>
                <td>Closes the task, locks it from edits, adds proofs to the archive.</td>
              </tr>
              <tr>
                <td>
                  <b>Every action above</b>
                </td>
                <td>System</td>
                <td>
                  Writes a timestamped entry (who, what, when) to the log. Only a Developer can
                  read it.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Overdue</b>
                </td>
                <td>System (scheduler)</td>
                <td>Flags the task in red, starts the escalation ladder below.</td>
              </tr>
              <tr>
                <td>
                  <b>Change path / reassign</b>
                </td>
                <td>Developer, Owner</td>
                <td>
                  Allowed only on open tasks. The change is logged with old and new assignee.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass sec">
        <h3>Scoring rules</h3>
        <div className="two">
          <div>
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Importance</th>
                  <th>Base points</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="tag Low">Low</span>
                  </td>
                  <td>1</td>
                </tr>
                <tr>
                  <td>
                    <span className="tag Medium">Medium</span>
                  </td>
                  <td>3</td>
                </tr>
                <tr>
                  <td>
                    <span className="tag High">High</span>
                  </td>
                  <td>5</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <ul>
              <li>Points go to the person who completes a stage, one score event per stage.</li>
              <li>
                Finished on or before the due date: <b>1.5×</b> base points. After the due date:{' '}
                <b>1×</b>.
              </li>
              <li>
                A send-back removes the points for that stage; they are earned again when it is
                redone.
              </li>
              <li>
                Reports total points by employee, team (location), branch, month, financial year
                (1 Apr – 31 Mar) or any custom date range.
              </li>
              <li>
                Score events are append-only. Corrections are new events with negative points,
                never edits.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="glass sec">
        <h3>Notifications and escalation</h3>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who is told</th>
                <th>Channel</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Task assigned or sent back</td>
                <td>New current assignee</td>
                <td>Push + in-app</td>
              </tr>
              <tr>
                <td>1 day before due date</td>
                <td>Current assignee</td>
                <td>Push</td>
              </tr>
              <tr>
                <td>Due date, not done</td>
                <td>Current assignee + Process Coordinator</td>
                <td>Push + email</td>
              </tr>
              <tr>
                <td>1 day overdue</td>
                <td>Finalizer of that location</td>
                <td>Push + email</td>
              </tr>
              <tr>
                <td>3 days overdue</td>
                <td>Company Owner</td>
                <td>Email + daily digest</td>
              </tr>
              <tr>
                <td>Weekly summary (Monday 9:00 IST)</td>
                <td>Owner, Finalizer, Auditor</td>
                <td>Email</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub">
          Cloud Scheduler runs the checks every hour. Reminder times are settings the Developer
          can change without a release.
        </div>
      </div>

      <div className="glass sec">
        <h3>Attendance module</h3>
        <div className="two">
          <div>
            <ul>
              <li>
                Each employee records <b>check-in</b>, <b>break start / end</b> and{' '}
                <b>check-out</b> from the web app or plant mobile app.
              </li>
              <li>
                Working days follow a per-location calendar: weekly offs and a holiday list managed
                by Developer or Owner.
              </li>
              <li>
                Worked hours = check-out − check-in − breaks. Late arrival and short hours are
                flagged against the shift.
              </li>
            </ul>
          </div>
          <div>
            <ul>
              <li>
                Staff see only their own record. Coordinators see their team, Finalizer / Auditor /
                Owner see all locations they are scoped to.
              </li>
              <li>
                Monthly attendance rate by employee, team or location feeds Reports and the payroll
                input export (CSV).
              </li>
              <li>Corrections after the fact need a reason and are logged with the approver.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="glass sec">
        <h3>Data model (Firestore)</h3>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Collection</th>
                <th>Key fields</th>
                <th>Read</th>
                <th>Write</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>users</b>
                </td>
                <td>uid, name, email, role, branch, location, active</td>
                <td>Self; admins all</td>
                <td>Developer, Owner (via function)</td>
              </tr>
              <tr>
                <td>
                  <b>roles</b>
                </td>
                <td>name, permissions[], branchScope, locationScope</td>
                <td>All signed-in users</td>
                <td>Developer, Owner</td>
              </tr>
              <tr>
                <td>
                  <b>branches / locations</b>
                </td>
                <td>name, code, active</td>
                <td>All signed-in users</td>
                <td>Developer</td>
              </tr>
              <tr>
                <td>
                  <b>paths</b>
                </td>
                <td>name, stages[&#123;assignee | group&#125;]</td>
                <td>Roles with &quot;Design paths&quot; + assignees</td>
                <td>Roles with &quot;Design paths&quot;</td>
              </tr>
              <tr>
                <td>
                  <b>tasks</b>
                </td>
                <td>title, branch, location, priority, pathId, stage, dueAt, status, proofs[]</td>
                <td>People on the path; roles with all-task scope</td>
                <td>Create: &quot;Create tasks&quot;. Stage change: function only</td>
              </tr>
              <tr>
                <td>
                  <b>scoreEvents</b>
                </td>
                <td>uid, taskId, points, reason, at</td>
                <td>Self; &quot;View all KPI&quot; roles</td>
                <td>Function only, append-only</td>
              </tr>
              <tr>
                <td>
                  <b>attendance</b>
                </td>
                <td>uid, date, in, out, breaks[], location, note</td>
                <td>Self; coordinators for their team; admins</td>
                <td>Self for today; corrections by approver</td>
              </tr>
              <tr>
                <td>
                  <b>holidays</b>
                </td>
                <td>date, location, name</td>
                <td>All signed-in users</td>
                <td>Developer, Owner</td>
              </tr>
              <tr>
                <td>
                  <b>auditLog</b>
                </td>
                <td>actor, action, target, before, after, at</td>
                <td>Developer only</td>
                <td>Function only, never edited or deleted</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub">
          Stage changes, score events and audit entries are written by server functions, never
          directly from the browser. This is what stops a user from approving their own task or
          editing their own score.
        </div>
      </div>

      <div className="glass sec">
        <h3>Security and operations</h3>
        <div className="two">
          <div>
            <h4>Access</h4>
            <ul>
              <li>
                Sign-in with Firebase Auth. Passwords are hashed by Firebase and never stored by the
                app.
              </li>
              <li>
                Role and scope live in custom claims; Firestore rules and the API both check them
                on every request.
              </li>
              <li>Two-step verification is required for Developer and Owner accounts.</li>
              <li>Deactivating a user ends their sessions straight away; their history stays.</li>
            </ul>
          </div>
          <div>
            <h4>Data and recovery</h4>
            <ul>
              <li>Hosted in the Mumbai region (asia-south1) so data stays in India.</li>
              <li>
                Daily Firestore export to a separate bucket, kept 30 days; monthly copy kept 1
                year.
              </li>
              <li>Plant app works offline and syncs when the connection returns.</li>
              <li>
                Uploaded proofs: images and PDFs only, 10 MB limit, virus-scanned before they are
                attached.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="glass sec">
        <h3>Build roadmap to production</h3>
        <ol>
          <li>
            <b>Phase 1 (wk 1–2):</b> Firebase project, Auth, role claims, Firestore schema,
            security rules, audit log.
          </li>
          <li>
            <b>Phase 2 (wk 3–5):</b> Task and configurable multi-stage path engine (individual or
            group per stage), send-back, user management screens.
          </li>
          <li>
            <b>Phase 3 (wk 6–7):</b> Scoring engine, KPI dashboards (month / FY / date range), team
            scores, report export.
          </li>
          <li>
            <b>Phase 4 (wk 8–9):</b> Attendance with holidays and breaks, notifications,
            escalation, file proofs, plant mobile PWA with offline mode.
          </li>
          <li>
            <b>Phase 5 (wk 10–11):</b> Move prototype data into Firestore, UAT with Bengaluru and
            both plants, load test, backup restore drill, go-live on Cloud Run.
          </li>
        </ol>
        <h4>Ready to go live when</h4>
        <ul>
          <li>
            Every role has been tested against its row in the data model table, including attempts
            to read or write what it should not.
          </li>
          <li>A backup has been restored successfully into a test project.</li>
          <li>Owner and Developer accounts have two-step verification on.</li>
          <li>Each location has completed one full week of real tasks and attendance in UAT.</li>
        </ul>
        <div className="sub" style={{ marginTop: 12 }}>
          <b>Connected to Firestore:</b> This application persists users, roles, branches,
          locations, workflow paths, tasks, append-only score events, attendance with breaks,
          holidays, notifications, and the immutable audit log in Firebase Firestore.
        </div>
      </div>

      <div className="glass sec" id="manual">
        <h3>User manual</h3>
        <div className="sub" style={{ marginBottom: 8 }}>
          How to use KEJMIN OPS day to day. Open a topic to read it. You only see the screens your
          role allows, so some topics will not apply to you.
        </div>

        <details open>
          <summary>1. Getting started</summary>
          <div>
            <p>
              <b>Sign in</b>
            </p>
            <ol>
              <li>
                On the first screen choose <b>Sign in</b>.
              </li>
              <li>
                Type your <b>User ID</b> and <b>Password</b>. Use <b>Show</b> to check what you
                typed.
              </li>
              <li>
                Press <b>Sign in</b> or the Enter key. The app remembers you on this browser until
                you log out.
              </li>
            </ol>
            <p>
              <b>Create an account</b>
            </p>
            <ol>
              <li>
                Choose <b>Create account</b>.
              </li>
              <li>
                Fill in your full name, a User ID, a password and the same password again, then
                pick your branch and location.
              </li>
              <li>
                Press <b>Create account</b>. You are signed in straight away.
              </li>
            </ol>
            <ul>
              <li>
                User ID: 3 to 20 letters, numbers, dots or underscores. It cannot be changed later.
              </li>
              <li>Password: at least 6 characters.</li>
              <li>Your full name must be unique in the company.</li>
              <li>
                New accounts get the role <b>Process Coordinator</b> at Bengaluru Office and{' '}
                <b>Plant Staff</b> at the plants. An admin can change this under User management.
              </li>
            </ul>
            <p>
              <b>Sign out:</b> press <b>Log out</b> at the bottom of the left menu. Always do this
              on a shared computer.
            </p>
            <p>
              <b>Moving around:</b> use the left menu. The top bar shows your name, role and
              location. On a computer, press the arrow at the top of the menu to retract it to a
              slim bar with just the logo and icons, which gives the page more room. Hover over the
              slim bar to see the full menu. Press the arrow again to keep the menu open.
            </p>
          </div>
        </details>

        <details>
          <summary>2. Dashboard</summary>
          <div>
            <p>
              Shows four counts: <b>Total tasks</b>, <b>In progress</b>, <b>Completed</b> and{' '}
              <b>High priority open</b>. Below them, <b>Branch workload</b> shows how your tasks
              are spread across MIS, Operations, Sales, Accounts &amp; Finance, Plant Coordination
              and HR.
            </p>
            <p>
              Developer, Owner, Finalizer and Auditor see every task. Everyone else sees only the
              tasks they are on the process path for.
            </p>
          </div>
        </details>

        <details>
          <summary>3. Tasks: see, finish and send back</summary>
          <div>
            <ol>
              <li>
                Open <b>Tasks</b>. The tiles at the top count your tasks: <b>All tasks</b>,{' '}
                <b>Waiting on you</b>, <b>In progress</b>, <b>Overdue</b> and <b>Completed</b>.
                Click a tile to show only those tasks.
              </li>
              <li>
                Use <b>Search</b>, <b>Branch</b>, <b>Location</b>, <b>Importance</b> and{' '}
                <b>Sort by</b> to narrow the list. Switch between <b>List</b> and <b>Board</b> (Not
                started, In progress, Completed). The app remembers your choice.
              </li>
              <li>
                Each task card shows its branch, location, importance, due date and a stage
                tracker. A <b>blue tick</b> means that person has finished, the <b>orange ring</b>{' '}
                is whose turn it is, and <b>grey</b> circles are waiting.
              </li>
              <li>
                Cards with <b>Your turn</b> are waiting on you. Press <b>Mark done</b> when your
                stage is really finished. The task moves to the next person and you earn points.
              </li>
              <li>Click the task title to open a level-by-level view of who has done what.</li>
              <li>
                The due line turns red with <b>Overdue by N days</b> when the date has passed.
              </li>
            </ol>
            <p>
              <b>Send back:</b> if you are Auditor, Finalizer, Owner or Developer, a{' '}
              <b>Send back</b> button appears on tasks that are past their first stage. It returns
              the task one stage to the previous person with a required reason and reverses the
              stage points.
            </p>
            <p>
              When the last person marks it done, the card shows <b>Completed</b>.
            </p>
            <div className="note">
              Only mark a stage done when the work is really finished. The next person is notified
              by the task moving to them, and your score is recorded at that moment.
            </div>
          </div>
        </details>

        <details>
          <summary>4. Workflow builder: create a task</summary>
          <div>
            <ol>
              <li>
                Open <b>Workflow builder</b>.
              </li>
              <li>
                Enter the <b>Title</b>, then choose <b>Branch</b>, <b>Location</b>,{' '}
                <b>Importance</b> (Low, Medium or High) and <b>Due date</b>.
              </li>
              <li>
                Optional: pick a <b>template</b> (Employee onboarding, Plant daily report, Invoice
                approval, Attendance and payroll input) to fill in the stages for you.
              </li>
              <li>
                Under <b>Process path</b>, choose a person for <b>Level 1</b>, <b>Level 2</b> and
                so on. Each level hands over to the next when marked done. Press{' '}
                <b>+ Add stage</b> for more levels.
              </li>
              <li>
                Press <b>Create task</b>. You land on the Tasks screen with the new task at the
                top.
              </li>
            </ol>
            <p>A title and at least one stage are required. Levels left blank are skipped.</p>
          </div>
        </details>

        <details>
          <summary>5. KPI and scores</summary>
          <div>
            <ol>
              <li>
                Open <b>KPI &amp; scores</b>.
              </li>
              <li>
                Choose <b>From</b> and <b>To</b> dates, or press <b>This month</b> or{' '}
                <b>Financial year</b> (from 1 April).
              </li>
              <li>Read the ranking: employee, score and a progress bar.</li>
            </ol>
            <p>
              Points for each completed stage: <b>Low 1, Medium 3, High 5</b>. Finish on or before
              the due date and you get <b>1.5 times</b> the points. Managers (Developer, Owner,
              Finalizer, Auditor) see everyone. Other staff see only their own score.
            </p>
          </div>
        </details>

        <details>
          <summary>6. Attendance</summary>
          <div>
            <p>
              The Attendance screen has up to four tabs: <b>Today</b>, <b>My month</b>, <b>Team</b>{' '}
              and <b>Settings</b>.
            </p>
            <p>
              <b>Clock in, breaks and clock out (Today tab)</b>
            </p>
            <ol>
              <li>
                Press <b>Clock in</b> when you start work. The time is saved.
              </li>
              <li>
                Use <b>Start break</b> and <b>End break</b> to log breaks during your shift.
              </li>
              <li>
                Press <b>Clock out</b> when you finish. Worked hours (net of breaks) are shown.
              </li>
            </ol>
            <p>
              You can clock in once a day. If you forget to clock out, the day shows{' '}
              <b>No clock-out</b> afterwards and an admin can record a correction with a reason.
            </p>
            <p>
              <b>My month:</b> pick a month with the arrows. You see working days, present, late
              marks, absent, hours worked, overtime and attendance percentage, then a colour
              calendar (Present, Late / half day, Absent, Holiday). Click a day to see its details.
              Managers can pick another employee from the list.
            </p>
            <p>
              <b>Team</b> (Developer, Owner, Finalizer, Auditor): each person&apos;s status,
              clock-in and clock-out times and hours across the company today.
            </p>
            <p>
              <b>Settings</b> (Developer, Owner): tick the working days, set shift start, shift end
              and grace minutes, and add or remove holidays (date, name and location).
            </p>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <b>Present</b>
                    </td>
                    <td>Clocked in within shift start plus grace minutes and worked at least 4 hours.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Late</b>
                    </td>
                    <td>Clocked in after shift start plus grace minutes. Counts as a full day with a late mark.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Half day</b>
                    </td>
                    <td>Worked less than 4 hours. Counts as half a day.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Absent</b>
                    </td>
                    <td>Working day in the past with no clock-in.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Working</b>
                    </td>
                    <td>Clocked in today and not yet clocked out.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Not clocked in</b>
                    </td>
                    <td>Working day today and you have not clocked in yet.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>No clock-out</b>
                    </td>
                    <td>A past day with a clock-in but no clock-out.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Holiday</b> / <b>Weekly off</b>
                    </td>
                    <td>Not a working day. Hours worked on these days count as overtime.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>

        <details>
          <summary>7. Reports</summary>
          <div>
            <ol>
              <li>
                Open <b>Reports</b>.
              </li>
              <li>
                Set <b>From</b> and <b>To</b>, then narrow by <b>Branch</b> and <b>Location</b> if
                you wish.
              </li>
              <li>
                Use <b>View by</b> (Overall, Employee wise, Team wise or Role wise) and{' '}
                <b>Select</b> to focus on one person, team or role.
              </li>
              <li>
                Read the summary cards (total points, completion rate, overdue tasks, top
                performer) and the charts for employee scores, task status, importance mix,
                six-month trend, branch completion, team score and attendance rate.
              </li>
              <li>
                The <b>Activity log</b> at the bottom lists the latest actions.
              </li>
            </ol>
            <p>
              <b>Export CSV</b> opens a text box with the data (including payroll attendance hours)
              and copies it. Paste it into Notepad or Excel and save it as a .csv file.{' '}
              <b>Print</b> opens your browser&apos;s print window, which can also save as PDF.
            </p>
          </div>
        </details>

        <details>
          <summary>8. Roles and access</summary>
          <div>
            <p>
              The table lists each role, its branch and location scope and the actions it may take:
              create tasks, design paths, approve or send back, view all KPI, export reports,
              manage roles and manage users.
            </p>
            <p>
              <b>Create a custom role</b> (Developer and Owner only): enter a role name, pick the
              branch and location scope, tick the permissions and press <b>Create role</b>. The
              role can then be given to users in User management.
            </p>
          </div>
        </details>

        <details>
          <summary>9. User management (Developer and Owner)</summary>
          <div>
            <ul>
              <li>
                <b>Add user:</b> enter a User ID, full name, a temporary password (one is
                suggested), role, branch and location, then press <b>Create user</b>. Tell the
                person their temporary password; they can change it in My profile.
              </li>
              <li>
                <b>Find users:</b> search by name or User ID, or filter by role.
              </li>
              <li>
                <b>Edit:</b> change name, role, branch or location.
              </li>
              <li>
                <b>Reset password:</b> a new password is suggested. Press <b>Reset</b> and share it
                with the user.
              </li>
              <li>
                <b>Delete:</b> the user can no longer sign in. You are warned if tasks are waiting
                on them, and past scores stay in the history.
              </li>
            </ul>
            <p>
              You cannot delete the account you are signed in with, and at least one Developer
              account must always remain.
            </p>
          </div>
        </details>

        <details>
          <summary>10. My profile</summary>
          <div>
            <ul>
              <li>
                <b>Details:</b> change your name, phone and designation, then press{' '}
                <b>Save changes</b>. User ID, branch and location are locked; ask an admin to
                change them.
              </li>
              <li>
                <b>Profile picture:</b> press <b>Upload photo</b> in the banner at the top of My
                profile and choose a JPG or PNG up to 5 MB. It is cropped to a square and shown in
                the top bar, on your profile and in User management. Press <b>Remove</b> to go back
                to your initial.
              </li>
              <li>
                <b>Security:</b> enter your current password, the new one twice, and press{' '}
                <b>Update password</b>. Use 6 or more characters; mixing upper and lower case,
                numbers and symbols makes it stronger.
              </li>
              <li>
                <b>Activity:</b> your recent actions and your own task, points and attendance
                figures.
              </li>
            </ul>
          </div>
        </details>

        <details>
          <summary>11. What each role can see and do</summary>
          <div>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Tasks and scores</th>
                    <th>Special actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <b>Developer</b>
                    </td>
                    <td>All</td>
                    <td>Everything, including users, roles, attendance settings and the Log.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Company Owner</b>
                    </td>
                    <td>All</td>
                    <td>Users, roles and attendance settings. Can send tasks back.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Finalizer</b>
                    </td>
                    <td>All</td>
                    <td>Can send tasks back. Sees the Team attendance tab.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Auditor</b>
                    </td>
                    <td>All</td>
                    <td>Can send tasks back. Sees the Team attendance tab.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Process Coordinator</b>
                    </td>
                    <td>Own tasks and own score</td>
                    <td>Finishes stages assigned to them.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Plant Staff</b>
                    </td>
                    <td>Own tasks and own score</td>
                    <td>Finishes stages assigned to them.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="sub">Custom roles follow the permissions ticked when they were created.</p>
          </div>
        </details>

        <details>
          <summary>12. Log (Developer only)</summary>
          <div>
            <p>
              The <b>Log</b> menu appears only for Developer accounts. It keeps a timestamped
              record of what people do in the app. Each line shows the <b>time</b> (date, hours,
              minutes, seconds), the <b>user</b>, the <b>type</b> and <b>what happened</b>.
            </p>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>What is recorded</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <b>Sign-in</b>
                    </td>
                    <td>Successful sign-ins and sign-outs.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Security</b>
                    </td>
                    <td>
                      Failed sign-in attempts, password changes and password resets. Passwords
                      themselves are never recorded.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Task</b>
                    </td>
                    <td>
                      Task created (with branch, location, importance, due date and path), each
                      stage completed with the points earned, path changes, and tasks sent back.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>User</b>
                    </td>
                    <td>
                      Users created, new accounts registered, and changes to name, role, branch,
                      location, phone or designation.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Delete</b>
                    </td>
                    <td>Users deleted and holidays removed.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Attendance</b>
                    </td>
                    <td>
                      Clock in, breaks, clock out, corrections, working days, shift times, grace
                      minutes and holidays added.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Role</b>
                    </td>
                    <td>Custom roles created or updated, with their permissions.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Export</b>
                    </td>
                    <td>Report CSV exports and printouts.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Upload</b>
                    </td>
                    <td>Task proof attachments (images and PDFs up to 10 MB).</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <b>Find something:</b> set <b>From</b> and <b>To</b> dates (the last 30 days are
              shown at first), then narrow by <b>User</b>, <b>Type</b> or <b>Search</b> text. The
              summary line under the command shows how many events, users, events today and
              deletions match. The newest 200 lines are listed; press <b>load more</b> for older
              ones.
            </p>
            <p>
              <b>export csv</b> puts the filtered lines in a text box and copies them. Paste into
              Excel or Notepad and save as .csv.
            </p>
            <div className="note">
              Nobody can edit or delete audit log entries. They are persisted immutably in
              Firestore with server timestamps.
            </div>
          </div>
        </details>

        <details>
          <summary>13. Questions and fixes</summary>
          <div>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Problem</th>
                    <th>What to do</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>I cannot sign in</td>
                    <td>
                      Check the User ID and password (passwords are case sensitive). If you forgot
                      it, ask a Developer or Owner for a reset.
                    </td>
                  </tr>
                  <tr>
                    <td>&quot;That user ID is already taken&quot; when signing up</td>
                    <td>Choose another ID, for example your first name, a dot and your initial.</td>
                  </tr>
                  <tr>
                    <td>I do not see a menu item</td>
                    <td>Your role does not include it. Ask an admin if you need access.</td>
                  </tr>
                  <tr>
                    <td>There is no Mark done button on my task</td>
                    <td>
                      The task is waiting on someone earlier in the path, or it is already
                      finished. Open the task to see whose turn it is.
                    </td>
                  </tr>
                  <tr>
                    <td>My day shows Late but I was on time</td>
                    <td>
                      The shift start and grace minutes in Attendance settings decide this. Ask an
                      admin to check them.
                    </td>
                  </tr>
                  <tr>
                    <td>My day shows No clock-out</td>
                    <td>You did not clock out. Ask an admin for a correction.</td>
                  </tr>
                  <tr>
                    <td>Export CSV shows a box instead of a file</td>
                    <td>
                      This is expected. Copy the text, paste it into Notepad or Excel and save it
                      as .csv.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};
