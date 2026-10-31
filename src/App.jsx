
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const OPERATORS = [
  { id: "magnum", name: "MAGNUM 4D" },
  { id: "toto", name: "SPORTS TOTO" },
  { id: "damacai", name: "DA MA CAI" },
];

const API = "https://4dlivetoday.com/api/v1";

function App() {
  const [page, setPage] = useState("home");
  const [operator, setOperator] = useState("magnum");
  const [live, setLive] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Format nomor 4D agar angka nol di depan tetap terlihat.
  function format4D(number) {
    if (number === null || number === undefined || number === "") {
      return "—";
    }
    return String(number).padStart(4, "0");
  }

  // Mengambil daftar hasil dari berbagai format respons API.
  function extractRows(result) {
    if (Array.isArray(result)) return result;

    const possibleRows =
      result?.data?.results ||
      result?.results ||
      result?.data ||
      result?.result ||
      [];

    return Array.isArray(possibleRows) ? possibleRows : [];
  }

  // Memeriksa status login admin.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Memuat Live dan History saat aplikasi dibuka.
  useEffect(() => {
    loadLive();
    loadHistory();

    const timer = setInterval(() => {
      loadLive();
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // Memuat History ketika operator berubah.
  useEffect(() => {
    loadHistory();
  }, [operator]);

  // LIVE RESULTS
  async function loadLive() {
    try {
      const response = await fetch(`${API}/latest`);

      if (!response.ok) {
        throw new Error("Live data unavailable");
      }

      const data = await response.json();
      const allResults = extractRows(data);

      const allowedOperators = ["magnum", "toto", "damacai"];

      const results = allResults.filter((item) =>
        allowedOperators.includes(item.operator)
      );

      setLive(results);
    } catch (error) {
      console.error("Live error:", error);
      setLive([]);
    }
  }

  // HISTORY FROM SUPABASE
  async function loadHistory() {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("m4d_history")
        .select("*")
        .eq("operator", operator)
        .order("draw_date", { ascending: false })
        .limit(200);

      if (error) throw error;

      setHistory(data || []);
    } catch (error) {
      console.error("History error:", error);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  // CONVERT API DATA TO DATABASE FORMAT
  function mapApiRow(row, operatorId) {
    return {
      operator: operatorId,
      draw_date: row.date || row.draw_date || null,
      draw_no: row.draw_no || row.draw || null,
      first_prize: format4D(row.first || row.first_prize),
      second_prize: format4D(row.second || row.second_prize),
      third_prize: format4D(row.third || row.third_prize),
      special: Array.isArray(row.special)
        ? row.special.map(format4D)
        : [],
      consolation: Array.isArray(row.consolation)
        ? row.consolation.map(format4D)
        : [],
    };
  }

  // ADMIN SYNCHRONIZATION
  async function syncHistory() {
    if (!session) {
      setMessage("Silakan login admin terlebih dahulu.");
      return;
    }

    setSyncing(true);
    setMessage("Mengambil data terbaru...");

    let successCount = 0;

    for (const item of OPERATORS) {
      try {
        const response = await fetch(
          `${API}/operators/${item.id}?limit=30`
        );

        if (!response.ok) {
          throw new Error("API tidak tersedia");
        }

        const result = await response.json();
        const rows = extractRows(result);

        const databaseRows = rows
          .map((row) => mapApiRow(row, item.id))
          .filter((row) => row.draw_date);

        if (databaseRows.length > 0) {
          const { error } = await supabase
            .from("m4d_history")
            .upsert(databaseRows, {
              onConflict: "operator,draw_date",
            });

          if (error) throw error;
        }

        successCount++;

        setMessage(
          `${item.name}: ${databaseRows.length} data berhasil diproses.`
        );
      } catch (error) {
        console.error(`${item.name} sync error:`, error);
        setMessage(`${item.name}: ${error.message}`);
      }
    }

    await loadHistory();

    setSyncing(false);
    setMessage(
      `Sinkronisasi selesai. ${successCount} dari ${OPERATORS.length} operator berhasil diproses.`
    );
  }

  // ADMIN LOGIN
  async function login() {
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setPassword("");
      setMessage("Login admin berhasil.");
    }
  }

  // ADMIN LOGOUT
  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Anda sudah logout.");
    }
  }

  // EXPORT HISTORY TO CSV
  function exportCSV() {
    const headers = [
      "Tanggal",
      "Nomor Draw",
      "First Prize",
      "Second Prize",
      "Third Prize",
      "Special Prize",
      "Consolation Prize",
    ];

    const rows = history.map((item) => [
      item.draw_date,
      item.draw_no,
      item.first_prize,
      item.second_prize,
      item.third_prize,
      Array.isArray(item.special) ? item.special.join(" ") : "",
      Array.isArray(item.consolation)
        ? item.consolation.join(" ")
        : "",
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) =>
            `"${String(value ?? "").replace(/"/g, '""')}"`
          )
          .join(",")
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `M4D-${operator}-history.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  // SEARCH HISTORY
  const filteredHistory = history.filter((item) => {
    const searchable = [
      item.draw_date,
      item.draw_no,
      item.first_prize,
      item.second_prize,
      item.third_prize,
      ...(Array.isArray(item.special) ? item.special : []),
      ...(Array.isArray(item.consolation) ? item.consolation : []),
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(search.toLowerCase());
  });

  // NUMBER FREQUENCY ANALYSIS
  const numberFrequency = {};

  history.forEach((item) => {
    const allNumbers = [
      item.first_prize,
      item.second_prize,
      item.third_prize,
      ...(Array.isArray(item.special) ? item.special : []),
      ...(Array.isArray(item.consolation) ? item.consolation : []),
    ];

    allNumbers.forEach((number) => {
      if (number) {
        const formatted = format4D(number);
        numberFrequency[formatted] =
          (numberFrequency[formatted] || 0) + 1;
      }
    });
  });

  const statistics = Object.entries(numberFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // BOTTOM NAVIGATION
  function NavButton({ id, icon, label }) {
    return (
      <button
        className={`nav-item ${page === id ? "active" : ""}`}
        onClick={() => setPage(id)}
      >
        <span>{icon}</span>
        <small>{label}</small>
      </button>
    );
  }

  return (
    <div className="app-shell">

      {/* HEADER */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">4D</div>
          <div>
            <h1>M4D SMART</h1>
            <p>MALAYSIA 4D DIGIT</p>
          </div>
        </div>

        <span className="live-indicator">
          <i /> LIVE
        </span>
      </header>

      <main className="main-content">

        {/* HOME */}
        {page === "home" && (
          <>
            <section className="hero-card">
              <span className="eyebrow">WELCOME TO</span>
              <h2>M4D SMART</h2>

              <p>
                Your 4D results dashboard. Live results,
                historical records, and number statistics
                in one place.
              </p>

              <button
                className="gold-button"
                onClick={() => setPage("live")}
              >
                VIEW LIVE RESULTS →
              </button>
            </section>

            <section className="section-heading">
              <div>
                <span className="eyebrow">YOUR DASHBOARD</span>
                <h2>Quick Access</h2>
              </div>
            </section>

            <div className="quick-grid">
              {[
                ["📡", "Live Results", "live"],
                ["📚", "History", "history"],
                ["📊", "Statistics", "analysis"],
                ["⚙️", "Admin", "admin"],
              ].map(([icon, label, target]) => (
                <button
                  className="quick-card"
                  key={target}
                  onClick={() => setPage(target)}
                >
                  <span>{icon}</span>
                  <strong>{label}</strong>
                  <small>Open section →</small>
                </button>
              ))}
            </div>

            <section className="info-card">
              <h3>About M4D SMART</h3>
              <p>
                Review published 4D results and historical
                statistics. Statistics describe past data
                and do not predict future winning numbers.
              </p>
            </section>
          </>
        )}

        {/* LIVE RESULTS */}
        {page === "live" && (
          <>
            <div className="page-title">
              <span className="eyebrow">REAL-TIME DASHBOARD</span>
              <h2>Live Results</h2>
              <p>Data refreshes automatically every 60 seconds.</p>
            </div>

            <button className="outline-button" onClick={loadLive}>
              ↻ Refresh Results
            </button>

            {live.length === 0 ? (
              <div className="empty-state">
                <span>📡</span>
                <h3>No live data available</h3>
                <p>Please try refreshing later.</p>
              </div>
            ) : (
              live.map((item, index) => (
                <div className="result-card" key={item.operator || index}>
                  <div className="result-card-head">
                    <strong>
                      {OPERATORS.find(
                        (op) => op.id === item.operator
                      )?.name || "4D RESULT"}
                    </strong>

                    <span>
                      DRAW {item.draw_no || "—"} |{" "}
                      {item.date || item.draw_date || ""}
                    </span>
                  </div>

                  <div className="prize-row">
                    <div>
                      <small>1ST PRIZE</small>
                      <strong>
                        {format4D(item.first || item.first_prize)}
                      </strong>
                    </div>

                    <div>
                      <small>2ND PRIZE</small>
                      <strong>
                        {format4D(item.second || item.second_prize)}
                      </strong>
                    </div>

                    <div>
                      <small>3RD PRIZE</small>
                      <strong>
                        {format4D(item.third || item.third_prize)}
                      </strong>
                    </div>
                  </div>

                  <div className="extra-prizes">
                    <div className="extra-prize-section">
                      <h4>SPECIAL PRIZE</h4>

                      <div className="number-list">
                        {(Array.isArray(item.special)
                          ? item.special
                          : []
                        ).map((number, i) => (
                          <span key={i}>{format4D(number)}</span>
                        ))}
                      </div>
                    </div>

                    <div className="extra-prize-section">
                      <h4>CONSOLATION PRIZE</h4>

                      <div className="number-list">
                        {(Array.isArray(item.consolation)
                          ? item.consolation
                          : []
                        ).map((number, i) => (
                          <span key={i}>{format4D(number)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* HISTORY */}
        {page === "history" && (
          <>
            <div className="page-title">
              <span className="eyebrow">DATABASE RECORDS</span>
              <h2>Result History</h2>
              <p>Browse saved results by operator.</p>
            </div>

            <div className="operator-tabs">
              {OPERATORS.map((item) => (
                <button
                  key={item.id}
                  className={operator === item.id ? "selected" : ""}
                  onClick={() => setOperator(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <input
              className="search-input"
              placeholder="Search date or winning number..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="history-toolbar">
              <span>{filteredHistory.length} records</span>

              <button
                className="outline-button small"
                onClick={exportCSV}
              >
                ↓ Export CSV
              </button>
            </div>

            {loading ? (
              <p className="empty-state">Loading history...</p>
            ) : filteredHistory.length === 0 ? (
              <div className="empty-state">
                <span>📚</span>
                <h3>No records found</h3>
                <p>Login as admin and synchronize the database.</p>
              </div>
            ) : (
              filteredHistory.map((item, index) => (
                <div
                  className="history-card"
                  key={item.id || index}
                >
                  <div className="history-date">
                    <strong>
                      {item.draw_date || "Unknown date"}
                    </strong>

                    <span>Draw {item.draw_no || "—"}</span>
                  </div>

                  <div className="history-prizes">
                    <div>
                      <small>1ST</small>
                      <strong>{format4D(item.first_prize)}</strong>
                    </div>

                    <div>
                      <small>2ND</small>
                      <strong>{format4D(item.second_prize)}</strong>
                    </div>

                    <div>
                      <small>3RD</small>
                      <strong>{format4D(item.third_prize)}</strong>
                    </div>
                  </div>

                  <div className="extra-prizes">
                    <div className="extra-prize-section">
                      <h4>SPECIAL PRIZE</h4>

                      <div className="number-list">
                        {(Array.isArray(item.special)
                          ? item.special
                          : []
                        ).map((number, i) => (
                          <span key={i}>{format4D(number)}</span>
                        ))}
                      </div>
                    </div>

                    <div className="extra-prize-section">
                      <h4>CONSOLATION PRIZE</h4>

                      <div className="number-list">
                        {(Array.isArray(item.consolation)
                          ? item.consolation
                          : []
                        ).map((number, i) => (
                          <span key={i}>{format4D(number)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ANALYSIS */}
        {page === "analysis" && (
          <>
            <div className="page-title">
              <span className="eyebrow">DATA INSIGHTS</span>
              <h2>Smart Statistics</h2>
              <p>
                Frequency analysis of saved prize numbers.
              </p>
            </div>

            <div className="stat-summary">
              <span>Total saved draws</span>
              <strong>{history.length}</strong>
            </div>

            <div className="operator-tabs">
              {OPERATORS.map((item) => (
                <button
                  key={item.id}
                  className={operator === item.id ? "selected" : ""}
                  onClick={() => setOperator(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="info-card">
              <h3>Most Frequent Numbers</h3>

              {statistics.length === 0 ? (
                <p>No statistics available yet.</p>
              ) : (
                statistics.map(([number, count], index) => (
                  <div className="frequency-row" key={number}>
                    <span>
                      {index + 1}. {number}
                    </span>

                    <strong>{count} times</strong>
                  </div>
                ))
              )}
            </div>

            <p className="disclaimer">
              Frequency describes historical results. It is
              not a prediction or guarantee of future outcomes.
            </p>
          </>
        )}

        {/* ADMIN */}
        {page === "admin" && (
          <>
            <div className="page-title">
              <span className="eyebrow">CONTROL CENTER</span>
              <h2>Administrator</h2>
              <p>Manage your M4D SMART database.</p>
            </div>

            <div className="admin-card">
              {session ? (
                <>
                  <div className="admin-status">
                    <span className="status-dot" />
                    Admin session active
                  </div>

                  <p className="muted">
                    {session.user.email}
                  </p>

                  <button
                    className="gold-button full-button"
                    onClick={syncHistory}
                    disabled={syncing}
                  >
                    {syncing
                      ? "SYNCHRONIZING..."
                      : "SYNC ALL HISTORY"}
                  </button>

                  <button
                    className="outline-button full-button"
                    onClick={logout}
                  >
                    LOG OUT
                  </button>
                </>
              ) : (
                <>
                  <h3>Admin Login</h3>

                  <label>Email address</label>

                  <input
                    className="search-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Admin email"
                  />

                  <label>Password</label>

                  <input
                    className="search-input"
                    type="password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="Admin password"
                  />

                  <button
                    className="gold-button full-button"
                    onClick={login}
                  >
                    LOGIN
                  </button>
                </>
              )}

              {message && (
                <p className="admin-message">{message}</p>
              )}
            </div>

            <div className="info-card">
              <h3>Database Information</h3>
              <p>Provider: Supabase</p>
              <p>Access: Public read, administrator write</p>
              <p>History table: m4d_history</p>
            </div>
          </>
        )}
      </main>

      {/* BOTTOM NAVIGATION */}
      <nav className="bottom-nav">
        <NavButton id="home" icon="⌂" label="Home" />
        <NavButton id="live" icon="◉" label="Live" />
        <NavButton id="history" icon="▤" label="History" />
        <NavButton id="analysis" icon="▥" label="Analysis" />
        <NavButton id="admin" icon="⚙" label="Admin" />
      </nav>
    </div>
  );
}

export default App;
