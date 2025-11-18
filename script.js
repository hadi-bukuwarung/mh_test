// Global state
let allCategoryData = {}; // Store all date data for each category
let allDatesSet = new Set(); // Use Set for unique dates
let availableDates = []; // Sorted descending (Newest first)
let availableDatesAsc = []; // Sorted ascending
let dateIndexMap = {}; // Map dateStr -> index in availableDatesAsc
let allCategories = []; // Cached category list

let currentDate = null;
let tableData = [];
let sortConfig = { key: 'today_count', direction: 'desc' };
let filters = {
    date: null,
    status: 'all'
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadAndProcessData();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Sort headers for Page 1
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.getAttribute('data-sort');
            sortData(sortKey);
        });
    });
    
    // Status filter (Page 1)
    document.getElementById('status-filter').addEventListener('change', function(e) {
        filters.status = e.target.value;
        renderTable();
    });

    // Navigation Tabs
    document.getElementById('tab-dashboard').addEventListener('click', function() {
        switchTab('dashboard');
    });
    document.getElementById('tab-trends').addEventListener('click', function() {
        switchTab('trends');
    });
}

function switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Update views
    const dashView = document.getElementById('view-dashboard');
    const trendView = document.getElementById('view-trends');

    if (tabName === 'dashboard') {
        dashView.style.display = 'block';
        trendView.style.display = 'none';
    } else {
        dashView.style.display = 'none';
        trendView.style.display = 'block';
        renderTrendTable(); // Render on demand
    }
}

// Load and process CSV data
function loadAndProcessData() {
    // Reset storage
    allCategoryData = {};
    allDatesSet = new Set();
    availableDates = [];
    availableDatesAsc = [];
    dateIndexMap = {};
    allCategories = [];
    tableData = [];

    Papa.parse('zoho_ticket.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        worker: true, // Runs parsing in background thread
        chunk: function(results) {
            // Process data in chunks
            processChunk(results.data);
        },
        complete: function() {
            try {
                finalizeDataProcessing();
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

function processChunk(rows) {
    // Process a chunk of rows and update the global map
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const categoryRaw = row['real_category'];
        const createdTime = row['Created Time'];

        if (!categoryRaw || !createdTime) continue;

        const category = categoryRaw.trim();
        if (!category) continue;

        // Treat date literally as appears in file (YYYY-MM-DD part)
        const spaceIdx = createdTime.indexOf(' ');
        const dateStr = spaceIdx > 0 ? createdTime.slice(0, spaceIdx) : createdTime;

        if (!dateStr || dateStr.length < 10 || !dateStr.includes('-')) continue;

        allDatesSet.add(dateStr);

        let categoryMap = allCategoryData[category];
        if (!categoryMap) {
            categoryMap = {};
            allCategoryData[category] = categoryMap;
        }

        const prev = categoryMap[dateStr] || 0;
        categoryMap[dateStr] = prev + 1;
    }
}

function finalizeDataProcessing() {
    // Build sorted date lists and index map
    availableDatesAsc = Array.from(allDatesSet).sort(); // ascending
    if (availableDatesAsc.length === 0) {
        throw new Error("No valid dates found in data");
    }

    availableDates = [...availableDatesAsc].reverse(); // descending

    dateIndexMap = {};
    for (let i = 0; i < availableDatesAsc.length; i++) {
        dateIndexMap[availableDatesAsc[i]] = i;
    }

    // Cache categories
    allCategories = Object.keys(allCategoryData);

    // Select latest date automatically
    const latestDate = availableDates[0];
    filters.date = latestDate;

    // Update Header Date Display
    const [y, m, d] = latestDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d); 
    
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = dateObj.toLocaleDateString('en-US', dateOptions);

    // Hide loading and show content before heavy work, so UI paints first
    document.getElementById('loading').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'block';

    // Defer table build to next frame to keep UI responsive
    requestAnimationFrame(() => {
        updateTableForDate(latestDate);
    });
}

// --- Page 1 Logic ---

function updateTableForDate(dateStr) {
    currentDate = dateStr;
    
    document.getElementById('date-column-header').textContent = `Count (${dateStr})`;

    const processedData = [];
    const categories = allCategories;

    const lookbackWindow = 14;
    const currentIndex = dateIndexMap[dateStr];

    for (let c = 0; c < categories.length; c++) {
        const category = categories[c];
        const counts = allCategoryData[category];

        const todayCount = counts[dateStr] || 0;

        // Baseline using previous 14 indices in availableDatesAsc
        let totalCount = 0;
        let daysCounted = 0;

        if (typeof currentIndex === 'number') {
            const startIdx = Math.max(0, currentIndex - lookbackWindow);
            for (let i = startIdx; i < currentIndex; i++) {
                const dStr = availableDatesAsc[i];
                totalCount += counts[dStr] || 0;
                daysCounted++;
            }
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
    }

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
    tbody.innerHTML = '';

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

    for (let i = 0; i < filteredData.length; i++) {
        const item = filteredData[i];
        const tr = document.createElement('tr');
        
        let deltaClass = 'delta-neutral';
        if (item.delta > 0) deltaClass = 'delta-positive';
        if (item.delta < 0) deltaClass = 'delta-negative';

        tr.innerHTML = `
            <td class="category-cell">${escapeHtml(item.category)}</td>
            <td class="text-right today-cell">${item.today_count}</td>
            <td class="text-right baseline-cell">${item.baseline}</td>
            <td class="text-right delta-cell ${deltaClass}">${item.delta > 0 ? '+' : ''}${item.delta}</td>
            <td>${createAnomalyBadge(item)}</td>
        `;
        tbody.appendChild(tr);
    }
}

// --- Page 2 Logic: Daily Trend ---

function renderTrendTable() {
    const tbody = document.getElementById('trend-table-body');
    const thead = document.getElementById('trend-header-row');
    
    if (availableDates.length < 2) {
        tbody.innerHTML = '<tr><td colspan="100">Not enough data for trend analysis</td></tr>';
        return;
    }

    // Date Columns (Last 14 days, ascending)
    const trendDates = availableDates.slice(0, 14).reverse();
    
    // Build Header
    let headerHTML = '<th class="category-cell">Category</th><th>% Changes</th>';
    for (let i = 0; i < trendDates.length; i++) {
        const date = trendDates[i];
        headerHTML += `<th class="trend-date-header">${date}</th>`;
    }
    thead.innerHTML = headerHTML;

    // Build Rows
    const categories = allCategories.slice().sort();
    let rowsHTML = '';
    
    // Recent vs previous date
    const recentDate = availableDates[0];
    const prevDate = availableDates[1];

    for (let c = 0; c < categories.length; c++) {
        const category = categories[c];
        const counts = allCategoryData[category];

        const recentCount = counts[recentDate] || 0;
        const prevCount = counts[prevDate] || 0;
        
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
        for (let i = 0; i < trendDates.length; i++) {
            const date = trendDates[i];
            const count = counts[date] || 0;
            const isToday = date === recentDate;
            const cellStyle = isToday ? 'font-weight:bold; color:#f1f5f9;' : '';
            dateCells += `<td class="trend-val" style="${cellStyle}">${count}</td>`;
        }

        rowsHTML += `
            <tr>
                <td class="category-cell">${escapeHtml(category)}</td>
                <td>${changeHTML}</td>
                ${dateCells}
            </tr>
        `;
    }

    tbody.innerHTML = rowsHTML;
}

// --- Utilities ---

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createAnomalyBadge(item) {
    const badge = document.createElement('div');
    badge.classList.add('badge');
    
    if (!item.isAnomaly) {
        badge.classList.add('badge-normal');
        badge.innerHTML = `
            <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Normal</span>
        `;
        return badge.outerHTML;
    } 
    
    if (item.anomalyType === 'high') {
        badge.classList.add('badge-high');
        badge.innerHTML = `
            <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            <span>High Anomaly</span>
            <span class="badge-percent">+${item.percentChange}%</span>
        `;
    } else if (item.anomalyType === 'low') {
        badge.classList.add('badge-low');
        badge.innerHTML = `
            <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
                <polyline points="17 18 23 18 23 12"></polyline>
            </svg>
            <span>Low Anomaly</span>
            <span class="badge-percent">${item.percentChange}%</span>
        `;
    }
    
    return badge.outerHTML;
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}
