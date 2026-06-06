/* Chart.js helpers for SocialAI Pro KPI dashboards */
(() => {
  "use strict";
  const instances = new Map();

  function destroyAll() {
    for (const ch of instances.values()) ch.destroy();
    instances.clear();
  }

  function defaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#94a3b8", font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: "#64748b", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#64748b", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.06)" }, beginAtZero: true },
      },
    };
  }

  function line(id, labels, datasets) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    if (instances.has(id)) { instances.get(id).destroy(); instances.delete(id); }
    const ch = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: d.color,
          backgroundColor: d.fill || "transparent",
          tension: 0.35,
          fill: !!d.fill,
          pointRadius: 3,
          borderWidth: 2,
        })),
      },
      options: defaults(),
    });
    instances.set(id, ch);
  }

  function bar(id, labels, values, label, color = "#00e5ff") {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    if (instances.has(id)) { instances.get(id).destroy(); instances.delete(id); }
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label, data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 48 }],
      },
      options: defaults(),
    });
    instances.set(id, ch);
  }

  function doughnut(id, labels, values, colors) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    if (instances.has(id)) { instances.get(id).destroy(); instances.delete(id); }
    const ch = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#94a3b8", font: { size: 11 } } } },
      },
    });
    instances.set(id, ch);
  }

  window.KpiCharts = { destroyAll, line, bar, doughnut };
})();
