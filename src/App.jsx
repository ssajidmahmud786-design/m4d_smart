import { useEffect, useState } from "react";
import "./App.css";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";

const API_URL = "https://4dlivetoday.com/api/v1/latest";
const HISTORY_URL = "https://4dlivetoday.com/api/v1/operators/";

const operators = [
  { id: "magnum", name: "Magnum 4D" },
  { id: "toto", name: "Sports Toto" },
  { id: "damacai", name: "Da Ma Cai" },
];

function calculateStatistics(history) {
  const frequency = {};

  history.forEach((draw) => {
    const numbers = [
      draw.first,
      draw.second,
      draw.third,
      ...(draw.special || []),
      ...(draw.consolation || []),
    ];

    numbers.forEach((number) => {
      if (number !== null && number !== undefined && number !== "") {
        const value = String(number);
        frequency[value] = (frequency[value] || 0) + 1;
      }
    });
  });

  return Object.entries(frequency)
    .map(([number, count]) => ({ number, count }))
    .sort((a, b) => b.count - a.count);
}

function mapDatabaseRow(row) {
  return {
    date: row.draw_date,
    draw_no: row.draw_no || "",
    first: row.first_prize || "",
    second: row.second_prize || "",
    third: row.third_prize || "",
    special: Array.isArray(row.special_prizes) ? row.special_prizes : [],
    consolation: Array.isArray(row.consolation_prizes)
      ? row.consolation_prizes
      : [],
  };
}

function mapApiRow(draw, operator) {
  return {
    operator,
    draw_date: draw.date,
    draw_no: draw.draw_no ? String(draw.draw_no) : null,
    first_prize: draw.first ? String(draw.first) : null,
    second_prize: draw.second ? String(draw.second) : null,
    third_prize: draw.third ? String(draw.third) : null,
    special_prizes: draw.special || [],
    consolation_prizes: draw.consolation || [],
  };
}

function App() {
  const [results, setResults] = useState([]);
  const [session, setSession] = useState(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("m4d_history_magnum") || "[]"
      );
    } catch {
      return [];
    }
  });

  const [historyLoading, setHistoryLoading] = useState(true);
  const [selected, setSelected] = useState("magnum");
  const [searchDate, setSearchDate] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function adminLogin(event) {
    event.preventDefault();
    setLoginLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

    setLoginLoading(false);

    if (error) {
      alert("Login gagal: " + error.message);
      return;
    }

    setAdminPassword("");
    alert("Login admin berhasil!");
  }

  async function adminLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("Logout gagal: " + error.message);
      return;
    }

    alert("Admin berhasil logout.");
  }

  function backupDatabase() {
    const backupData = {
      app: "M4D SMART",
      backupDate: new Date().toISOString(),
      database: {
        magnum: JSON.parse(
          localStorage.getItem("m4d_history_magnum") || "[]"
        ),
        toto: JSON.parse(
          localStorage.getItem("m4d_history_toto") || "[]"
        ),
        damacai: JSON.parse(
          localStorage.getItem("m4d_history_damacai") || "[]"
        ),
      },
    };

    const blob = new Blob(
      [JSON.stringify(backupData, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "M4D_SMART_BACKUP.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function restoreDatabase(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const backupData = JSON.parse(e.target.result);

        if (backupData.app !== "M4D SMART" || !backupData.database) {
          throw new Error("File backup tidak valid.");
        }

        ["magnum", "toto", "damacai"].forEach((operator) => {
          const data = backupData.database[operator];

          if (Array.isArray(data)) {
            localStorage.setItem(
              `m4d_history_${operator}`,
              JSON.stringify(data)
            );
          }
        });

        alert(
          "Backup berhasil dipulihkan ke browser. Untuk memasukkannya ke Supabase, diperlukan proses sinkronisasi admin."
        );
        window.location.reload();
      } catch {
        alert("Gagal restore: file backup tidak valid.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  async function loadResults() {
    try {
      setError("");
      const response = await fetch(API_URL);

      if (!response.ok) {
        throw new Error("Gagal mengambil data hasil.");
      }

      const json = await response.json();
      setResults(json.data?.results || []);
    } catch (err) {
      setError(err.message || "Koneksi data bermasalah.");
    } finally {
      setLoading(false);
    }
  }

  // Ambil arsip dari Supabase untuk pengunjung/admin.
  // Jika Supabase belum memiliki data operator tersebut, gunakan API sebagai cadangan.
  async function loadHistory(operator) {
    try {
      setHistoryLoading(true);

      const { data: databaseRows, error: databaseError } = await supabase
        .from("m4d_history")
        .select(
          "operator, draw_date, draw_no, first_prize, second_prize, third_prize, special_prizes, consolation_prizes"
        )
        .eq("operator", operator)
        .order("draw_date", { ascending: false })
        .limit(1000);

      if (databaseError) {
        throw databaseError;
      }

      if (databaseRows && databaseRows.length > 0) {
        const savedHistory = databaseRows.map(mapDatabaseRow);
        setHistory(savedHistory);
        localStorage.setItem(
          `m4d_history_${operator}`,
          JSON.stringify(savedHistory)
        );
        return;
      }

      const response = await fetch(
        `${HISTORY_URL}${operator}?limit=30`
      );

      if (!response.ok) {
        throw new Error("Gagal mengambil arsip.");
      }

      const json = await response.json();
      const apiHistory = json.data?.results || [];

      setHistory(apiHistory);
      localStorage.setItem(
        `m4d_history_${operator}`,
        JSON.stringify(apiHistory)
      );
    } catch (err) {
      console.error("History error:", err);

      // Jika koneksi Supabase/API bermasalah, tampilkan salinan lokal.
      try {
        const savedHistory = JSON.parse(
          localStorage.getItem(`m4d_history_${operator}`) || "[]"
        );
        setHistory(savedHistory);
      } catch {
        setHistory([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  // Saat admin login, impor hingga 30 hasil terbaru untuk ketiga operator.
  async function syncInitialHistoryToSupabase() {
    for (const operator of operators) {
      try {
        const response = await fetch(
          `${HISTORY_URL}${operator.id}?limit=30`
        );

        if (!response.ok) {
          console.error("Gagal mengambil arsip:", operator.id);
          continue;
        }

        const json = await response.json();
        const apiHistory = json.data?.results || [];
        const databaseRows = apiHistory
          .filter((draw) => draw.date)
          .map((draw) => mapApiRow(draw, operator.id));

        if (databaseRows.length === 0) continue;

        const { error } = await supabase
          .from("m4d_history")
          .upsert(databaseRows, {
            onConflict: "operator,draw_date",
          });

       if (error) {
  alert(
    `Gagal menyimpan ${operator.name}: ${error.message}`
  );
} else {
  alert(
    `${operator.name}: ${databaseRows.length} data berhasil disimpan!`
  );
}
      } catch (err) {
        console.error(
          `Kesalahan sinkronisasi ${operator.name}:`,
          err
        );
      }
    }

    await loadHistory(selected);
  }

  // EXPORT EXCEL
  function exportToExcel() {
    let exportHistory = history;

    if (historyFilter === "date") {
      if (!searchDate) {
        alert("Silakan pilih tanggal terlebih dahulu.");
        return;
      }

      exportHistory = history.filter(
        (draw) => draw.date === searchDate
      );
    }

    if (exportHistory.length === 0) {
      alert("Tidak ada data untuk diekspor.");
      return;
    }

    const excelData = exportHistory.map((draw) => ({
      Operator: selected.toUpperCase(),
      Date: draw.date,
      Draw: draw.draw_no || "",
      "1st Prize": draw.first || "",
      "2nd Prize": draw.second || "",
      "3rd Prize": draw.third || "",
      Special: (draw.special || []).join(", "),
      Consolation: (draw.consolation || []).join(", "),
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const range = XLSX.utils.decode_range(worksheet["!ref"]);

    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      for (let col = 3; col <= 7; col++) {
        const cellAddress = XLSX.utils.encode_cell({
          r: row,
          c: col,
        });
        const cell = worksheet[cellAddress];

        if (cell) {
          cell.t = "s";
          cell.v = String(cell.v);
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "4D History"
    );

    const fileType =
      historyFilter === "date" ? "date" : "all_history";

    XLSX.writeFile(
      workbook,
      `M4D_SMART_${selected}_${fileType}.xlsx`
    );
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Session error:", error.message);
        return;
      }
      if (active) setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    loadResults();
    const timer = setInterval(loadResults, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadHistory(selected);
  }, [selected]);

  useEffect(() => {
    if (session) {
      syncInitialHistoryToSupabase();
    }
    // Jalankan impor awal saat status admin berubah menjadi login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const result = results.find(
    (item) => item.operator === selected
  );

  const dateResult = history.find(
    (item) => item.date === searchDate
  );

  const statistics = calculateStatistics(history);
  const hotNumbers = statistics.slice(0, 10);
  const coldNumbers = [...statistics]
    .sort((a, b) => a.count - b.count)
    .slice(0, 10);

  const digitFrequency = Array(10).fill(0);

  history.forEach((draw) => {
    const numbers = [
      draw.first,
      draw.second,
      draw.third,
      ...(draw.special || []),
      ...(draw.consolation || []),
    ];

    numbers.forEach((number) => {
      String(number ?? "")
        .split("")
        .forEach((digit) => {
          if (/^\d$/.test(digit)) {
            digitFrequency[Number(digit)]++;
          }
        });
    });
  });

  const filteredHistory = [...history].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  const displayedHistory =
    historyFilter === "date"
      ? filteredHistory.filter(
          (draw) => draw.date === searchDate
        )
      : filteredHistory;

  return (
    <div className="app">
      <header>
        <h1>M4D SMART</h1>
        <p>MALAYSIA 4D DIGIT</p>
      </header>

      <main>
        <section className="result-card">
          <h2>🔐 ADMIN LOGIN</h2>

          {session ? (
            <>
              <p>Admin login: {session.user.email}</p>
              <button onClick={adminLogout}>LOGOUT</button>
              <p>
                <small>
                  Admin aktif: sinkronisasi arsip awal berjalan otomatis.
                </small>
              </p>
            </>
          ) : (
            <form onSubmit={adminLogin}>
              <input
                type="email"
                placeholder="Admin email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                required
              />

              <input
                type="password"
                placeholder="Admin password"
                value={adminPassword}
                onChange={(event) =>
                  setAdminPassword(event.target.value)
                }
                required
              />

              <button type="submit" disabled={loginLoading}>
                {loginLoading ? "LOGGING IN..." : "LOGIN"}
              </button>
            </form>
          )}
        </section>

        <h2>LIVE 4D RESULTS</h2>

        {/* HISTORY SEARCH */}
        <section className="result-card">
          <h2>📅 HISTORY SEARCH</h2>
          <label htmlFor="search-date">
            Pilih tanggal undian:
          </label>
          <input
            id="search-date"
            type="date"
            value={searchDate}
            onChange={(event) => {
              setSearchDate(event.target.value);
              setHistoryFilter("date");
            }}
          />
        </section>

        {/* HISTORY RESULT */}
        {searchDate && (
          <section className="result-card">
            <h2>HISTORY RESULT</h2>

            {dateResult ? (
              <>
                <p>Tanggal: {dateResult.date}</p>
                <p>Nomor Draw: {dateResult.draw_no || "-"}</p>

                <div className="prize">
                  <h3>1st Prize</h3>
                  <strong>{dateResult.first}</strong>
                </div>

                <div className="prize">
                  <h3>2nd Prize</h3>
                  <strong>{dateResult.second}</strong>
                </div>

                <div className="prize">
                  <h3>3rd Prize</h3>
                  <strong>{dateResult.third}</strong>
                </div>

                <h3>Special</h3>
                <div className="numbers">
                  {(dateResult.special || []).map((number, index) => (
                    <span key={index}>{number}</span>
                  ))}
                </div>

                <h3>Consolation</h3>
                <div className="numbers">
                  {(dateResult.consolation || []).map((number, index) => (
                    <span key={index}>{number}</span>
                  ))}
                </div>
              </>
            ) : (
              <p>
                Tanggal ini belum ditemukan dalam arsip operator ini.
              </p>
            )}
          </section>
        )}

        {/* OPERATOR BUTTONS */}
        <div className="operators">
          {operators.map((operator) => (
            <button
              key={operator.id}
              className={selected === operator.id ? "active" : ""}
              onClick={() => setSelected(operator.id)}
            >
              {operator.name}
            </button>
          ))}
        </div>

        {/* LIVE RESULTS */}
        {loading && <p>Memuat hasil...</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && result && (
          <section className="result-card">
            <h2>{result.operator_name}</h2>
            <p>Tanggal: {result.date}</p>
            <p>Nomor Draw: {result.draw_no || "-"}</p>
            <p>Status: {result.status}</p>

            <div className="prize">
              <h3>1st Prize</h3>
              <strong>{result.first}</strong>
            </div>

            <div className="prize">
              <h3>2nd Prize</h3>
              <strong>{result.second}</strong>
            </div>

            <div className="prize">
              <h3>3rd Prize</h3>
              <strong>{result.third}</strong>
            </div>

            <h3>Special</h3>
            <div className="numbers">
              {(result.special || []).map((number, index) => (
                <span key={index}>{number}</span>
              ))}
            </div>

            <h3>Consolation</h3>
            <div className="numbers">
              {(result.consolation || []).map((number, index) => (
                <span key={index}>{number}</span>
              ))}
            </div>

            <p className="source">Sumber: 4dlivetoday.com</p>
          </section>
        )}

        {!loading && !error && !result && (
          <p>Data operator belum tersedia.</p>
        )}

        {/* HISTORY DATABASE */}
        <section className="result-card">
          <h2>📚 HISTORY DATABASE</h2>

          <button
            className="active"
            type="button"
            onClick={backupDatabase}
          >
            💾 BACKUP DATABASE
          </button>

          <div style={{ marginTop: "10px" }}>
            <label htmlFor="restore-file">
              📂 RESTORE DATABASE
            </label>
            <input
              id="restore-file"
              type="file"
              accept=".json,application/json"
              onChange={restoreDatabase}
            />
          </div>

          <p>Operator: {selected.toUpperCase()}</p>
          <p>Total arsip: {history.length}</p>

          <div className="operators">
            <button
              className={historyFilter === "all" ? "active" : ""}
              onClick={() => setHistoryFilter("all")}
            >
              ALL HISTORY
            </button>

            <button
              className={historyFilter === "date" ? "active" : ""}
              onClick={() => setHistoryFilter("date")}
            >
              SEARCH DATE
            </button>
          </div>

          <p>Menampilkan: {displayedHistory.length} undian</p>

          <button
            className="active"
            onClick={exportToExcel}
            disabled={historyLoading}
          >
            📥 EXPORT EXCEL
          </button>

          {historyLoading ? (
            <p>Memuat database...</p>
          ) : displayedHistory.length === 0 ? (
            <p>
              {historyFilter === "date" && !searchDate
                ? "Silakan pilih tanggal terlebih dahulu."
                : "Tidak ada riwayat untuk pilihan ini."}
            </p>
          ) : (
            <div className="history-table">
              {displayedHistory.map((draw, index) => (
                <div
                  className="history-row"
                  key={draw.date + "-" + index}
                >
                  <h3>{draw.date}</h3>
                  <p>Draw: {draw.draw_no || "-"}</p>
                  <p>
                    1st Prize: <strong>{draw.first}</strong>
                  </p>
                  <p>
                    2nd Prize: <strong>{draw.second}</strong>
                  </p>
                  <p>
                    3rd Prize: <strong>{draw.third}</strong>
                  </p>
                  <p>
                    Special: {(draw.special || []).join(", ")}
                  </p>
                  <p>
                    Consolation:{" "}
                    {(draw.consolation || []).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SMART STATISTICS */}
        <section className="result-card">
          <h2>SMART STATISTICS</h2>
          <p>Arsip: {selected.toUpperCase()}</p>

          {historyLoading ? (
            <p>Memuat arsip historis...</p>
          ) : (
            <>
              <p>Total undian: {history.length}</p>

              <h3>🔥 HOT NUMBERS — 10 Angka Teratas</h3>
              <div className="numbers">
                {hotNumbers.map((item) => (
                  <span key={item.number}>
                    {item.number} ({item.count}x)
                  </span>
                ))}
              </div>

              <h3>❄️ COLD NUMBERS — 10 Angka Terendah</h3>
              <div className="numbers">
                {coldNumbers.map((item) => (
                  <span key={item.number}>
                    {item.number} ({item.count}x)
                  </span>
                ))}
              </div>

              <h3>DIGIT ANALYSIS — 0 sampai 9</h3>
              <div className="numbers">
                {digitFrequency.map((count, digit) => (
                  <span key={digit}>
                    {digit}: {count}x
                  </span>
                ))}
              </div>

              <p className="source">
                Arsip tersimpan di Supabase jika tersedia, dengan salinan
                lokal di browser. Statistik ini bukan prediksi hasil berikutnya.
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
