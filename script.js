// Global state
let allCategoryData = {}; // Map: Category -> Date -> Count
let allDatesSet = new Set();
let availableDates = []; // Sorted descending
let currentDate = null;
let tableData = [];
let sortConfig = { key: 'today_count', direction: 'desc' };
let filters = {
    date: null,
    status: 'all'
};

document.addEventListener('DOMContentLoaded', function() {
    loadAndProcessData();
    setupEventListeners();
});

function setupEventListeners() {
    // Sorting
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.getAttribute('data-sort');
            sortData(sortKey);
        });
    });
    
    // Status Filter
    document.getElementById('status-filter').addEventListener('change', function(e) {
        filters.status = e.target.value;
        renderTable();
    });

    // Tabs
    document.getElementById('tab-dashboard').addEventListener('click', () => switchTab('dashboard'));
    document.getElementById('tab-trends').addEventListener('click', () => switchTab('trends'));
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    const dashView = document.getElementById('view-dashboard');
    const trendView = document.getElementById('view-trends');

    if (tabName === 'dashboard') {
        dashView.style.display = 'block';
        trendView.style.display = 'none';
    } else {
        dashView.style.display = 'none';
        trendView.style.display = 'block';
        renderTrendTable();
    }
}

function loadAndProcessData() {
    // NOTE: worker: false is faster for small files (<10MB) as it avoids async overhead
    Papa.parse('zoho_ticket.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        worker: false, 
        complete: function(results) {
            try {
                processAggregatedData(results.data);
            } catch (err) {
                console.error(err);
                showError('Error processing data: ' + err.message);
            }
        },
        error: function(err) {
            showError('Failed to load CSV file: ' + err);
        }
    });
}

function processAggregatedData(rows) {
    allCategoryData = {};
    allDatesSet = new Set();

    // Optimized loop for aggregated schema:
    // real_category, status, channel, date, num_of_ticket
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        const category = row['real_category']; // e.g. "Complaint::All::Massive Issue"
        const dateStr = row['date'];           // e.g. "2025-08-01"
        const countVal = row['num_of_ticket']; // e.g. "24"

        if (!category || !dateStr || !countVal) continue;

        // Safe Parse
        const count = parseInt(countVal, 10);
        if (isNaN(count)) continue;

        // Add to Set
        allDatesSet.add(dateStr);

        // Initialize Map
        if (!allCategoryData[category]) {
            allCategoryData[category] = {};
        }

        // Aggregate (Summing tickets if multiple rows exist for same cat/date)
        if (!allCategoryData[category][dateStr]) {
            allCategoryData[category][dateStr] = 0;
        }
        allCategoryData[category][dateStr] += count;
    }

    // Finalize
    availableDates = Array.from(allDatesSet).sort().reverse();

    if (availableDates.length === 0) {
        throw new Error("No valid dates found in data");
    }

    // Set Default Date (Most Recent)
    const latestDate = availableDates[0];
    filters.date = latestDate;
    
    // Update Date Display
    const [y, m, d] = latestDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    document.getElementById('current-date').textContent = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // UI Ready
    document.getElementById('loading').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'block';

    updateTableForDate(latestDate);
}

// --- Page 1: Dashboard Logic ---

function updateTableForDate(dateStr) {
    currentDate = dateStr;
    document.getElementById('date-column-header').textContent = `Count (${dateStr})`;

    const processedData = [];
    const categories = Object.keys(allCategoryData);
    const lookbackWindow = 21;

    // Parse Date safely once
    const [y, m, d] = dateStr.split('-').map(Number);
    const currentObj = new Date(y, m - 1, d, 12, 0, 0); // Noon to avoid DST shifts

    categories.forEach(category => {
        const dateMap = allCategoryData[category];
        const todayCount = dateMap[dateStr] || 0;

        // Baseline Logic
        let totalCount = 0;
        let daysCounted = 0;

        for (let i = 1; i <= lookbackWindow; i++) {
            const dOffset = new Date(currentObj);
            dOffset.setDate(currentObj.getDate() - i);
            
            // Fast format YYYY-MM-DD
            const ly = dOffset.getFullYear();
            const lm = String(dOffset.getMonth() + 1).padStart(2, '0');
            const ld = String(dOffset.getDate()).padStart(2, '0');
            const lookbackDateStr = `${ly}-${lm}-${ld}`;

            totalCount += (dateMap[lookbackDateStr] || 0);
            daysCounted++;
        }

        const baseline = daysCounted > 0 ? totalCount / daysCounted : 0;
        const delta = todayCount - baseline;
        
        let isAnomaly = false;
        let anomalyType = null;
        let percentChange = 0;

        if (baseline > 0) {
            percentChange = ((todayCount - baseline) / baseline) * 100;
        } else if (todayCount > 0) {
            percentChange = 100;
        }

        // Rules
        if (todayCount > baseline * 1.5 || todayCount > baseline + 10) {
            isAnomaly = true;
            anomalyType = 'high';
        } else if (todayCount < baseline * 0.7) {
            isAnomaly = true;
            anomalyType = 'low';
        }

        processedData.push({
            category: category,
            today_count: todayCount,
            baseline: parseFloat(baseline.toFixed(1)),
            delta: parseFloat(delta.toFixed(1)),
            isAnomaly: isAnomaly,
            anomalyType: anomalyType,
            percentChange: Math.round(percentChange)
        });
    });

    tableData = processedData;
    sortData(sortConfig.key, false);
}

function sortData(key, toggle = true) {
    if (toggle) {
        if (sortConfig.key === key) {
            sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortConfig.key = key;
            sortConfig.direction = 'desc';
            if (key === 'category') sortConfig.direction = 'asc';
        }
    }

    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('asc', 'desc');
        if (th.getAttribute('data-sort') === sortConfig.key) {
            th.classList.add(sortConfig.direction);
        }
    });

    tableData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (key === 'category') {
            return sortConfig.direction === 'asc' 
                ? valA.localeCompare(valB) 
                : valB.localeCompare(valA);
        }
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
    });

    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    // Batch string concatenation for DOM performance
    let htmlBuffer = '';

    const filteredData = tableData.filter(item => {
        if (filters.status === 'all') return true;
        if (filters.status === 'anomaly') return item.isAnomaly;
        if (filters.status === 'high') return item.anomalyType === 'high';
        if (filters.status === 'low') return item.anomalyType === 'low';
        if (filters.status === 'normal') return !item.isAnomaly;
        return true;
    });

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="text-align:center; color: #64748b;">No data matches filters</td></tr>';
        return;
    }

    filteredData.forEach(item => {
        let deltaClass = 'delta-neutral';
        if (item.delta > 0) deltaClass = 'delta-positive';
        if (item.delta < 0) deltaClass = 'delta-negative';

        htmlBuffer += `
            <tr>
                <td class="category-cell">${escapeHtml(item.category)}</td>
                <td class="text-right today-cell">${item.today_count}</td>
                <td class="text-right baseline-cell">${item.baseline}</td>
                <td class="text-right delta-cell ${deltaClass}">${item.delta > 0 ? '+' : ''}${item.delta}</td>
                <td>${createAnomalyBadge(item)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlBuffer;
}

// --- Page 2: Daily Trend Logic ---

function renderTrendTable() {
    const tbody = document.getElementById('trend-table-body');
    const thead = document.getElementById('trend-header-row');
    
    if (availableDates.length < 2) {
        tbody.innerHTML = '<tr><td colspan="100">Not enough data for trend analysis</td></tr>';
        return;
    }

    const trendDates = availableDates.slice(0, 14).reverse();
    
    let headerHTML = '<th class="category-cell">Category</th><th>% Changes</th>';
    trendDates.forEach(date => {
        headerHTML += `<th class="trend-date-header">${date}</th>`;
    });
    thead.innerHTML = headerHTML;

    const categories = Object.keys(allCategoryData).sort();
    let rowsHTML = '';
    
    const recentDate = availableDates[0];
    const prevDate = availableDates[1];

    categories.forEach(category => {
        const dateMap = allCategoryData[category];
        
        const recentCount = dateMap[recentDate] || 0;
        const prevCount = dateMap[prevDate] || 0;
        
        let changeHTML = '<span class="change-neutral">-</span>';
        let percent = 0;

        if (prevCount > 0) {
            percent = Math.round(((recentCount - prevCount) / prevCount) * 100);
            if (percent > 0) {
                changeHTML = `<span class="change-positive">🔴 ↑ Increased by ${percent}%</span>`;
            } else if (percent < 0) {
                changeHTML = `<span class="change-negative">🟢 ↓ Decreased by ${Math.abs(percent)}%</span>`;
            } else {
                changeHTML = `<span class="change-neutral">No Change</span>`;
            }
        } else if (recentCount > 0) {
             changeHTML = `<span class="change-positive">🔴 ↑ Increased (New)</span>`;
        } else {
             changeHTML = `<span class="change-neutral">0%</span>`;
        }

        let dateCells = '';
        trendDates.forEach(date => {
            const count = dateMap[date] || 0;
            const isToday = date === recentDate;
            const cellStyle = isToday ? 'font-weight:bold; color:#f1f5f9;' : '';
            dateCells += `<td class="trend-val" style="${cellStyle}">${count}</td>`;
        });

        rowsHTML += `
            <tr>
                <td class="category-cell">${escapeHtml(category)}</td>
                <td>${changeHTML}</td>
                ${dateCells}
            </tr>
        `;
    });

    tbody.innerHTML = rowsHTML;
}

// --- Utilities ---

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function createAnomalyBadge(item) {
    if (!item.isAnomaly) {
        return `
            <div class="badge badge-normal">
                <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Normal</span>
            </div>
        `;
    } 
    
    if (item.anomalyType === 'high') {
        return `
            <div class="badge badge-high">
                <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                    <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
                <span>High Anomaly</span>
                <span class="badge-percent">+${item.percentChange}%</span>
            </div>
        `;
    } else {
        return `
            <div class="badge badge-low">
                <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
                    <polyline points="17 18 23 18 23 12"></polyline>
                </svg>
                <span>Low Anomaly</span>
                <span class="badge-percent">${item.percentChange}%</span>
            </div>
        `;
    }
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}
