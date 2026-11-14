(() => {
  "use strict";

  const colors = ["#7669eb", "#20b6a5", "#48a9e8", "#efa85d", "#ec7d91", "#7589db"];
  const elements = {
    fileInput: document.querySelector("#file-input"),
    uploadButton: document.querySelector("#upload-button"),
    notice: document.querySelector("#notice"),
    regionRows: document.querySelector("#region-rows"),
    regionCount: document.querySelector("#region-count"),
  };
  const numberFormat = new Intl.NumberFormat("en-US");
  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  let sourceName = "churn-selected-columns.csv";

  function safeNumber(value) {
    if (value === undefined || value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }
    if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
    if (field.length > 0 || row.length > 0) {
      row.push(field.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    }
    if (rows.length < 2) throw new Error("The CSV does not contain any customer records.");

    const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
    const required = ["CreditScore", "Age", "Balance", "NumOfProducts", "Geography"];
    const missing = required.filter((column) => !headers.includes(column));
    if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));

    return rows.slice(1).map((cells) => {
      const creditScore = safeNumber(cells[indexes.CreditScore] || "");
      const age = safeNumber(cells[indexes.Age] || "");
      const balance = safeNumber(cells[indexes.Balance] || "");
      const products = safeNumber(cells[indexes.NumOfProducts] || "");
      const exited = indexes.Exited === undefined ? null : safeNumber(cells[indexes.Exited] || "");
      if ([creditScore, age, balance, products].some((value) => value === null)) return null;
      return {
        creditScore,
        age,
        balance,
        products,
        geography: (cells[indexes.Geography] || "").trim() || "Unknown",
        exited,
      };
    }).filter(Boolean);
  }

  function average(records, field) {
    return records.reduce((sum, record) => sum + record[field], 0) / records.length;
  }

  function makeBins(records, field, minimum, maximum, count = 18) {
    const bins = Array.from({ length: count }, () => 0);
    records.forEach((record) => {
      const position = Math.min(0.999999, Math.max(0, (record[field] - minimum) / (maximum - minimum)));
      bins[Math.floor(position * count)] += 1;
    });
    return bins;
  }

  function summarize(records) {
    if (!records.length) throw new Error("No valid customer records were found in this CSV.");
    const groups = new Map();
    const productCounts = new Map();
    records.forEach((record) => {
      if (!groups.has(record.geography)) groups.set(record.geography, []);
      groups.get(record.geography).push(record);
      productCounts.set(record.products, (productCounts.get(record.products) || 0) + 1);
    });
    const geographies = [...groups.entries()].map(([name, group]) => ({
      name,
      count: group.length,
      averageCreditScore: average(group, "creditScore"),
      averageBalance: average(group, "balance"),
      averageAge: average(group, "age"),
    })).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
    const churnRecords = records.filter((record) => record.exited === 0 || record.exited === 1);
    const churn = churnRecords.length
      ? { total: churnRecords.length, exited: churnRecords.filter((record) => record.exited === 1).length }
      : null;

    return {
      total: records.length,
      averageBalance: average(records, "balance"),
      averageCreditScore: average(records, "creditScore"),
      averageAge: average(records, "age"),
      geographies,
      ageBins: makeBins(records, "age", 18, 93),
      balanceBins: makeBins(records, "balance", 0, 250000),
      products: [...productCounts.entries()].sort((first, second) => first[0] - second[0])
        .map(([name, count]) => ({ name, count })),
      churn,
    };
  }

  function validateSummary(summary) {
    if (!summary || !Number.isFinite(summary.total) || summary.total < 1
      || !Array.isArray(summary.geographies) || !Array.isArray(summary.ageBins)
      || !Array.isArray(summary.balanceBins) || !Array.isArray(summary.products)) {
      throw new Error("The dashboard summary file has an invalid format.");
    }
  }

  function showNotice(message, isError = false) {
    elements.notice.textContent = message;
    elements.notice.classList.toggle("error", isError);
    elements.notice.hidden = !message;
  }

  function renderRegions(summary) {
    const rows = summary.geographies.map((region) => {
      const row = document.createElement("tr");
      const values = [
        region.name,
        numberFormat.format(region.count),
        `${((region.count / summary.total) * 100).toFixed(1)}%`,
        numberFormat.format(Math.round(region.averageCreditScore)),
        moneyFormat.format(region.averageBalance),
      ];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    });
    elements.regionRows.replaceChildren(...rows);
    elements.regionCount.textContent = `${numberFormat.format(summary.geographies.length)} regions · ${numberFormat.format(summary.total)} records summarized`;
  }

  function renderHistogram(target, bins, color) {
    const peak = Math.max(...bins, 1);
    const width = 500;
    const height = 128;
    const gap = 4;
    const barWidth = (width - gap * (bins.length - 1)) / bins.length;
    const bars = bins.map((value, index) => {
      const barHeight = (value / peak) * 90;
      const x = index * (barWidth + gap);
      const y = height - 19 - barHeight;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="3" fill="${color}" opacity="${value ? 0.88 : 0.16}"><title>${numberFormat.format(value)} customers</title></rect>`;
    }).join("");
    const guides = [0, 1, 2, 3].map((step) => {
      const y = 8 + step * 30;
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#eef1f6" stroke-dasharray="3 4"/>`;
    }).join("");
    const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution chart">${guides}${bars}<line x1="0" y1="${height - 18}" x2="${width}" y2="${height - 18}" stroke="#e8ecf3"/></svg>`;
    document.querySelector(target).innerHTML = svg;
  }

  function renderProducts(products) {
    const peak = Math.max(...products.map((product) => product.count), 1);
    const chart = document.querySelector("#products-chart");
    chart.replaceChildren(...products.map((product) => {
      const column = document.createElement("div");
      column.className = "product-column";
      const value = document.createElement("strong");
      value.textContent = numberFormat.format(product.count);
      const bar = document.createElement("div");
      bar.className = "product-bar";
      bar.style.height = `${Math.max(3, (product.count / peak) * 77)}px`;
      bar.title = `${numberFormat.format(product.count)} customers`;
      const label = document.createElement("span");
      label.textContent = `${product.name} ${product.name === 1 ? "product" : "products"}`;
      column.append(value, bar, label);
      return column;
    }));
  }

  function renderDashboard(summary) {
    validateSummary(summary);
    document.querySelector("#total-customers").textContent = numberFormat.format(summary.total);
    document.querySelector("#average-balance").textContent = moneyFormat.format(summary.averageBalance);
    document.querySelector("#average-score").textContent = Math.round(summary.averageCreditScore).toString();
    document.querySelector("#average-age").textContent = `${summary.averageAge.toFixed(1)} yrs`;
    document.querySelector("#customer-foot").textContent = `Across ${summary.geographies.length} regions`;
    document.querySelector("#updated-label").textContent = `${numberFormat.format(summary.total)} records summarized`;
    document.querySelector("#data-source").textContent = `Source: ${sourceName}`;
    renderHistogram("#age-chart", summary.ageBins, "#796deb");
    renderHistogram("#balance-chart", summary.balanceBins, "#27b9a8");
    renderProducts(summary.products);
    renderRegions(summary);

    if (summary.churn) {
      const rate = (summary.churn.exited / summary.churn.total) * 100;
      showNotice(`Aggregated view only. ${numberFormat.format(summary.total)} records summarized; churn rate is ${rate.toFixed(1)}% across records with an Exited value.`);
    } else {
      showNotice(`Aggregated view only. ${numberFormat.format(summary.total)} records summarized. This file does not include an Exited column, so churn is not available.`);
    }
  }

  async function loadDefaultDataset() {
    try {
      const response = await fetch("./dashboard-data.json");
      if (!response.ok) throw new Error(`Could not load the dashboard summary (HTTP ${response.status}).`);
      const summary = await response.json();
      sourceName = "churn-selected-columns.csv (aggregated)";
      renderDashboard(summary);
    } catch (error) {
      showNotice(`${error.message} Start a local web server to open this dashboard.`, true);
      document.querySelector("#updated-label").textContent = "Summary not loaded";
    }
  }

  elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const records = parseCsv(await file.text());
      sourceName = `${file.name} (aggregated locally)`;
      renderDashboard(summarize(records));
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      event.target.value = "";
    }
  });

  loadDefaultDataset();
})();
