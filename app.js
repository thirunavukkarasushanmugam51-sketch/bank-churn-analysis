(() => {
  "use strict";

  const PAGE_SIZE = 25;
  const colors = ["#7669eb", "#20b6a5", "#48a9e8", "#efa85d", "#ec7d91", "#7589db"];
  const elements = {
    fileInput: document.querySelector("#file-input"),
    uploadButton: document.querySelector("#upload-button"),
    uploadFeedback: document.querySelector("#upload-feedback"),
    fileProgress: document.querySelector("#file-progress"),
    notice: document.querySelector("#notice"),
    regionRows: document.querySelector("#region-rows"),
    regionCount: document.querySelector("#region-count"),
    uploadedRecords: document.querySelector("#uploaded-records"),
    recordSearch: document.querySelector("#record-search"),
    recordRows: document.querySelector("#record-rows"),
    recordEmpty: document.querySelector("#record-empty"),
    recordCount: document.querySelector("#record-count"),
    pageLabel: document.querySelector("#page-label"),
    previousPage: document.querySelector("#previous-page"),
    nextPage: document.querySelector("#next-page"),
  };
  const numberFormat = new Intl.NumberFormat("en-US");
  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  let sourceName = "churn-selected-columns.csv";
  let csvWorker = null;
  let activeRequest = 0;
  let currentPage = 1;
  let searchTimer = null;

  function showNotice(message, isError = false) {
    elements.notice.textContent = message;
    elements.notice.classList.toggle("error", isError);
    elements.notice.hidden = !message;
  }

  function renderRegions(summary) {
    const rows = summary.geographies.map((region) => {
      const row = document.createElement("tr");
      [
        region.name,
        numberFormat.format(region.count),
        `${((region.count / summary.total) * 100).toFixed(1)}%`,
        region.averageCreditScore.toFixed(1),
        moneyFormat.format(region.averageBalance),
      ].forEach((value) => {
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
    if (!summary || !Number.isFinite(summary.total) || summary.total < 1
      || !Array.isArray(summary.geographies) || !Array.isArray(summary.ageBins)
      || !Array.isArray(summary.balanceBins) || !Array.isArray(summary.products)) {
      throw new Error("The dashboard summary file has an invalid format.");
    }

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

  function requestRecordPage(page = currentPage) {
    if (!csvWorker) return;
    currentPage = page;
    activeRequest += 1;
    csvWorker.postMessage({
      type: "page",
      requestId: activeRequest,
      page: currentPage,
      pageSize: PAGE_SIZE,
      search: elements.recordSearch.value.trim(),
    });
  }

  function renderRecordPage(result) {
    const start = (result.page - 1) * PAGE_SIZE;
    elements.recordRows.replaceChildren(...result.records.map((record, index) => {
      const row = document.createElement("tr");
      const customerCell = document.createElement("td");
      const customer = document.createElement("div");
      customer.className = "customer-cell";
      const avatar = document.createElement("span");
      avatar.className = "customer-avatar";
      avatar.textContent = (record.surname || "R").slice(0, 1);
      const name = document.createElement("span");
      name.append(document.createTextNode(record.surname || "Customer"));
      const id = document.createElement("span");
      id.className = "customer-id";
      id.textContent = record.customerId ? `ID ${record.customerId}` : `Record ${numberFormat.format(start + index + 1)}`;
      name.append(id);
      customer.append(avatar, name);
      customerCell.append(customer);

      const values = [
        record.geography,
        numberFormat.format(record.creditScore),
        `${numberFormat.format(record.age)} yrs`,
        moneyFormat.format(record.balance),
        Number.isFinite(record.products) ? record.products.toString() : "—",
      ];
      row.append(customerCell);
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    }));
    elements.recordEmpty.hidden = result.total > 0;
    elements.recordCount.textContent = result.total
      ? `Showing ${numberFormat.format(start + 1)}–${numberFormat.format(Math.min(start + result.records.length, result.total))} of ${numberFormat.format(result.total)} matching records`
      : "Showing 0 matching records";
    elements.pageLabel.textContent = `${result.page} / ${result.pageCount}`;
    elements.previousPage.disabled = result.page <= 1;
    elements.nextPage.disabled = result.page >= result.pageCount;
  }

  function handleWorkerMessage(event) {
    const message = event.data;
    if (message.type === "progress") {
      const percent = message.totalBytes ? Math.floor((message.loadedBytes / message.totalBytes) * 100) : 0;
      elements.fileProgress.value = percent;
      elements.uploadFeedback.textContent = `Reading ${sourceName}: ${percent}% · ${numberFormat.format(message.validRecords)} valid records found`;
      return;
    }
    if (message.type === "error") {
      elements.fileProgress.hidden = true;
      elements.uploadButton.disabled = false;
      elements.fileInput.disabled = false;
      elements.uploadFeedback.classList.add("error");
      elements.uploadFeedback.textContent = `Could not read the CSV: ${message.message}`;
      return;
    }
    if (message.type === "complete") {
      try {
        renderDashboard(message.summary);
      } catch (error) {
        elements.uploadFeedback.classList.add("error");
        elements.uploadFeedback.textContent = error.message;
        elements.fileProgress.hidden = true;
        elements.uploadButton.disabled = false;
        elements.fileInput.disabled = false;
        return;
      }
      elements.uploadedRecords.hidden = false;
      elements.uploadFeedback.classList.remove("error");
      elements.uploadFeedback.textContent = `${sourceName} is ready · ${numberFormat.format(message.summary.total)} records loaded. Search below to view the uploaded rows.`;
      elements.fileProgress.value = 100;
      elements.fileProgress.hidden = true;
      elements.uploadButton.disabled = false;
      elements.fileInput.disabled = false;
      elements.recordSearch.value = "";
      requestRecordPage(1);
      elements.uploadedRecords.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (message.type === "page" && message.requestId === activeRequest) {
      renderRecordPage(message);
    }
  }

  function beginUpload(file) {
    if (csvWorker) csvWorker.terminate();
    try {
      csvWorker = new Worker("./csv-worker.js");
    } catch (error) {
      elements.uploadFeedback.classList.add("error");
      elements.uploadFeedback.textContent = `Could not start the CSV reader: ${error.message}`;
      return;
    }
    csvWorker.addEventListener("message", handleWorkerMessage);
    csvWorker.addEventListener("error", (event) => {
      elements.fileProgress.hidden = true;
      elements.uploadButton.disabled = false;
      elements.fileInput.disabled = false;
      elements.uploadFeedback.classList.add("error");
      elements.uploadFeedback.textContent = `CSV processing stopped: ${event.message || "Unknown worker error."}`;
    }, { once: true });

    sourceName = file.name;
    currentPage = 1;
    elements.uploadButton.disabled = true;
    elements.fileInput.disabled = true;
    elements.fileProgress.hidden = false;
    elements.fileProgress.value = 0;
    elements.uploadFeedback.classList.remove("error");
    elements.uploadFeedback.textContent = `Preparing ${file.name}…`;
    elements.uploadedRecords.hidden = true;
    showNotice("");
    csvWorker.postMessage({ type: "parse", file });
  }

  async function loadDefaultDataset() {
    try {
      const response = await fetch("./dashboard-data.json");
      if (!response.ok) throw new Error(`Could not load the dashboard summary (HTTP ${response.status}).`);
      const summary = await response.json();
      sourceName = "churn-selected-columns.csv (aggregated)";
      renderDashboard(summary);
      elements.uploadFeedback.textContent = "Choose a CSV to view its records. Files you select stay in this browser.";
    } catch (error) {
      showNotice(`${error.message} Start a local web server to open this dashboard.`, true);
      document.querySelector("#updated-label").textContent = "Summary not loaded";
    }
  }

  elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) beginUpload(file);
    event.target.value = "";
  });
  elements.recordSearch.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => requestRecordPage(1), 180);
  });
  elements.previousPage.addEventListener("click", () => requestRecordPage(currentPage - 1));
  elements.nextPage.addEventListener("click", () => requestRecordPage(currentPage + 1));

  loadDefaultDataset();
})();
