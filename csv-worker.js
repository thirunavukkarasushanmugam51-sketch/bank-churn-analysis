"use strict";

let records = [];

function safeNumber(value) {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function processCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let headers = null;
    let indexes = null;
    let row = [];
    let field = "";
    let quoted = false;
    let pendingQuote = false;
    let validCount = 0;
    let skippedCount = 0;
    let loadedBytes = 0;
    let lastProgress = -1;
    let totalCreditScore = 0;
    let totalAge = 0;
    let totalBalance = 0;
    let exitedCount = 0;
    let churnTotal = 0;
    const regions = new Map();
    const products = new Map();
    const ageBins = Array(18).fill(0);
    const balanceBins = Array(18).fill(0);

    function finishRow() {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (!row.some((cell) => cell.trim() !== "")) {
        row = [];
        return;
      }

      if (!headers) {
        headers = row.map((header) => header.trim().replace(/^\uFEFF/, ""));
        const required = ["CreditScore", "Age", "Balance", "NumOfProducts", "Geography"];
        const missing = required.filter((column) => !headers.includes(column));
        if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
        indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
        row = [];
        return;
      }

      const creditScore = safeNumber(row[indexes.CreditScore] || "");
      const age = safeNumber(row[indexes.Age] || "");
      const balance = safeNumber(row[indexes.Balance] || "");
      const productCount = safeNumber(row[indexes.NumOfProducts] || "");
      if ([creditScore, age, balance, productCount].some((value) => value === null)) {
        skippedCount += 1;
        row = [];
        return;
      }

      const geography = (row[indexes.Geography] || "").trim() || "Unknown";
      const exited = indexes.Exited === undefined ? null : safeNumber(row[indexes.Exited] || "");
      const record = {
        customerId: indexes.CustomerId === undefined ? "" : (row[indexes.CustomerId] || "").trim(),
        surname: indexes.Surname === undefined ? "" : (row[indexes.Surname] || "").trim(),
        creditScore,
        age,
        balance,
        products: productCount,
        geography,
        recordNumber: validCount + skippedCount + 1,
      };
      records.push(record);
      validCount += 1;
      totalCreditScore += creditScore;
      totalAge += age;
      totalBalance += balance;

      const region = regions.get(geography) || { name: geography, count: 0, creditScore: 0, balance: 0, age: 0 };
      region.count += 1;
      region.creditScore += creditScore;
      region.balance += balance;
      region.age += age;
      regions.set(geography, region);
      products.set(productCount, (products.get(productCount) || 0) + 1);
      ageBins[Math.min(ageBins.length - 1, Math.max(0, Math.floor(((age - 18) / 75) * ageBins.length)))] += 1;
      balanceBins[Math.min(balanceBins.length - 1, Math.max(0, Math.floor((balance / 250000) * balanceBins.length)))] += 1;
      if (exited === 0 || exited === 1) {
        churnTotal += 1;
        if (exited === 1) exitedCount += 1;
      }
      row = [];
    }

    function consume(text, final = false) {
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted && pendingQuote) {
          pendingQuote = false;
          if (character === '"') {
            field += '"';
            continue;
          }
          quoted = false;
        }
        if (quoted) {
          if (character === '"') pendingQuote = true;
          else field += character;
        } else if (character === '"' && field.length === 0) {
          quoted = true;
        } else if (character === ",") {
          row.push(field);
          field = "";
        } else if (character === "\n") {
          finishRow();
        } else {
          field += character;
        }
      }

      if (final) {
        if (pendingQuote) {
          pendingQuote = false;
          quoted = false;
        }
        if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
        if (field.length > 0 || row.length > 0) finishRow();
      }
    }

    async function read() {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        loadedBytes += result.value.byteLength;
        consume(decoder.decode(result.value, { stream: true }));
        const percent = file.size ? Math.floor((loadedBytes / file.size) * 100) : 0;
        if (percent !== lastProgress) {
          lastProgress = percent;
          self.postMessage({ type: "progress", loadedBytes, totalBytes: file.size, validRecords: validCount });
        }
      }
      consume(decoder.decode(), true);
      if (!headers) throw new Error("The CSV does not contain a header row and customer records.");
      if (!validCount) throw new Error("No valid customer records were found in this CSV.");

      resolve({
        total: validCount,
        skippedRows: skippedCount,
        averageBalance: totalBalance / validCount,
        averageCreditScore: totalCreditScore / validCount,
        averageAge: totalAge / validCount,
        geographies: [...regions.values()].map((region) => ({
          name: region.name,
          count: region.count,
          averageCreditScore: region.creditScore / region.count,
          averageBalance: region.balance / region.count,
          averageAge: region.age / region.count,
        })).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name)),
        ageBins,
        balanceBins,
        products: [...products.entries()].sort((first, second) => first[0] - second[0])
          .map(([name, count]) => ({ name, count })),
        churn: churnTotal ? { total: churnTotal, exited: exitedCount } : null,
      });
    }

    read().catch((error) => {
      reader.cancel().catch(() => {});
      reject(error);
    });
  });
}

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (message.type === "parse") {
    records = [];
    try {
      const summary = await processCsv(message.file);
      self.postMessage({ type: "complete", summary });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message || "Unknown CSV error." });
    }
    return;
  }

  if (message.type === "page") {
    const search = message.search.trim().toLocaleLowerCase();
    const filtered = search
      ? records.filter((record) => `${record.surname} ${record.customerId} ${record.geography}`.toLocaleLowerCase().includes(search))
      : records;
    const pageSize = Math.max(1, message.pageSize);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, message.page));
    const start = (page - 1) * pageSize;
    self.postMessage({
      type: "page",
      requestId: message.requestId,
      page,
      pageCount,
      total: filtered.length,
      records: filtered.slice(start, start + pageSize),
    });
  }
});
