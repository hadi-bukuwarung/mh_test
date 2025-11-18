// Global state
let allCategoryData = {}; // Map: Category -> Date -> Count
let allDatesSet = new Set();
let availableDates = []; // Sorted descending (Index 0 = Newest)
let currentDate = null;
let tableData = [];
let sortConfig = { key: 'today_count', direction: 'desc' };

// Filters
let filters = {
    date: null,
    status: 'all',
    trendCategory: 'all',
    trendSubcategory: 'all'
};

document.addEventListener('DOMContentLoaded', function() {
    loadAndProcessData();
    setupEventListeners();
});

function setupEventListeners() {
    // Sorting (Dashboard)
    const headers = document.querySelectorAll('#data-table th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.getAttribute('data-sort');
            sortData(sortKey);
        });
    });
    
    // Dashboard Filters
    document.getElementById('status-filter').addEventListener('change', function(e) {
        filters.status = e.target.value;
        renderTable();
    });

    // Trend Filters
    document.getElementById('trend-category-filter').addEventListener('change', function(e) {
        filters.trendCategory = e.target.value;
        filters.trendSubcategory = 'all';
        document.getElementById('trend-subcategory-filter').value = 'all';
        updateSubcategoryOptions();
        renderTrendTable();
    });

    document.getElementById('trend-subcategory-filter').addEventListener('change', function(e) {
        filters.trendSubcategory = e.target.value;
        renderTrendTable();
    });

    // Tabs
    document.getElementById('tab-dashboard').addEventListener('click', () => switchTab('dashboard'));
    document.getElementById('tab-trends').addEventListener('click', () => switchTab('trends'));
    document.getElementById('tab-feed').addEventListener('click', () => switchTab('feed'));
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    const views = ['view-dashboard', 'view-trends', 'view-feed'];
    views.forEach(id => document.getElementById(id).style.display = 'none');

    if (tabName === 'dashboard') {
        document.getElementById('view-dashboard').style.display = 'block';
        renderTable(); 
    } else if (tabName === 'trends') {
        document.getElementById('view-trends').style.display = 'block';
        if (availableDates.length > 0) renderTrendTable();
    } else if (tabName === 'feed') {
        document.getElementById('view-feed').style.display = 'block';
        if (availableDates.length > 0) renderAnomalyFeed();
    }
}

function loadAndProcessData() {
    Papa.parse('zoho_ticket.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        worker: false, 
        complete: function(results) {
            try {
                processAggregatedData(results.data, results.meta.fields);
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

function processAggregatedData(rows, headers) {
    if (!rows || rows.length === 0) throw new Error("CSV file is empty");

    const findHeader = (target) => {
        if (!headers) return target;
        const match = headers.find(h => h.trim().toLowerCase().replace(/^[\uFEFF\n\r]+/, '') === target.toLowerCase());
        return match || target; 
    };

    const catCol = findHeader('real_category');
    const dateCol = findHeader('date');
    const countCol = findHeader('num_of_ticket');

    if (!rows[0].hasOwnProperty(catCol) || !rows[0].hasOwnProperty(dateCol)) {
        throw new Error(`Missing required columns. Found: ${headers.join(', ')}. Expected 'real_category' and 'date'.`);
    }

    allCategoryData = {};
    allDatesSet = new Set();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const category = row[catCol];
        const dateStr = row[dateCol];
        let count = 1;

        if (countCol && row[countCol]) {
            count = parseInt(row[countCol], 10);
            if (isNaN(count)) count = 0;
        }

        if (!category || !dateStr) continue;

        const trimmedDate = dateStr.trim();
        if (trimmedDate.length < 10) continue;

        allDatesSet.add(trimmedDate);

        if (!allCategoryData[category]) {
            allCategoryData[category] = {};
        }
        if (!allCategoryData[category][trimmedDate]) {
            allCategoryData[category][trimmedDate] = 0;
        }
        allCategoryData[category][trimmedDate] += count;
    }

    availableDates = Array.from(allDatesSet).sort().reverse(); 
    if (availableDates.length === 0) {
        throw new Error("No valid dates found.");
    }

    populateFilterOptions();

    const latestDate = availableDates[0];
    filters.date = latestDate;
    
    try {
        const [y, m, d] = latestDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        document.getElementById('current-date').textContent = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
        document.getElementById('current-date').textContent = latestDate;
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'block';

    updateTableForDate(latestDate);
}

// --- Core Calculation Logic ---
function getMetricsForDate(category, dateStr) {
    const dateMap = allCategoryData[category] || {};
    const todayCount = dateMap[dateStr] || 0;
    const lookbackWindow = 21;
    
    const [y, m, d] = dateStr.split('-').map(Number);
    const currentObj = new Date(y, m - 1, d, 12, 0, 0);

    let totalCount = 0;
    let daysCounted = 0;

    for (let i = 1; i <= lookbackWindow; i++) {
        const dOffset = new Date(currentObj);
        dOffset.setDate(currentObj.getDate() - i);
        
        const ly = dOffset.getFullYear();
        const lm = String(dOffset.getMonth() + 1).padStart(2, '0');
        const ld = String(dOffset.getDate()).padStart(2, '0');
        const lookbackDateStr = `${ly}-${lm}-${ld}`;

        totalCount += (dateMap[lookbackDateStr] || 0);
        daysCounted++;
    }

    const baseline = daysCounted > 0 ? parseFloat((totalCount / daysCounted).toFixed(1)) : 0;
    const delta = parseFloat((todayCount - baseline).toFixed(1));
    
    let isAnomaly = false;
    let anomalyType = null;
    let percentChange = 0;

    if (baseline > 0) {
        percentChange = Math.round(((todayCount - baseline) / baseline) * 100);
    } else if (todayCount > 0) {
        percentChange = 100;
    }

    if (todayCount > baseline * 1.5 || todayCount > baseline + 10) {
        isAnomaly = true;
        anomalyType = 'high';
    } else if (todayCount < baseline * 0.7 && baseline > 0) {
        isAnomaly = true;
        anomalyType = 'low';
    }

    return {
        category,
        date: dateStr,
        today_count: todayCount,
        baseline,
        delta,
        isAnomaly,
        anomalyType,
        percentChange
    };
}

// --- Page 1: Dashboard ---

function updateTableForDate(dateStr) {
    currentDate = dateStr;
    document.getElementById('date-column-header').textContent = `Count (${dateStr})`;
    
    tableData = Object.keys(allCategoryData).map(cat => getMetricsForDate(cat, dateStr));
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

    document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
        th.classList.remove('asc', 'desc');
        if (th.getAttribute('data-sort') === sortConfig.key) {
            th.classList.add(sortConfig.direction);
        }
    });

    tableData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        if (key === 'category') {
            return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
    });

    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    let htmlBuffer = '';

    const filteredData = tableData.filter(item => {
        if (filters.status === 'anomaly' && !item.isAnomaly) return false;
        if (filters.status === 'high' && item.anomalyType !== 'high') return false;
        if (filters.status === 'low' && item.anomalyType !== 'low') return false;
        if (filters.status === 'normal' && item.isAnomaly) return false;
        return true;
    });

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 2rem; color: #64748b;">No data matches filters</td></tr>';
        return;
    }

    filteredData.forEach(item => {
        let deltaClass = 'delta-neutral';
        if (item.delta > 0) deltaClass = 'delta-positive';
        if (item.delta < 0) deltaClass = 'delta-negative';
        let deltaSign = item.delta > 0 ? '+' : '';

        htmlBuffer += `
            <tr>
                <td class="category-cell">${escapeHtml(item.category)}</td>
                <td class="text-right today-cell">${item.today_count}</td>
                <td class="text-right baseline-cell">${item.baseline}</td>
                <td class="text-right delta-cell ${deltaClass}">${deltaSign}${item.delta}</td>
                <td>${createAnomalyBadge(item)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlBuffer;
}

// --- Page 3: Anomaly Feed Logic ---

function renderAnomalyFeed() {
    const tbody = document.getElementById('feed-table-body');
    const historyWindow = 14;
    
    if (availableDates.length === 0) return;

    // Use Last 14 Days Window
    const dates = availableDates.slice(0, historyWindow); 

    const problematicData = [];
    const categories = Object.keys(allCategoryData);

    categories.forEach(cat => {
        const history = [];
        // Filter ONLY High Anomalies
        dates.forEach((date) => {
            const metrics = getMetricsForDate(cat, date);
            // STRICT FILTER: Only keep rows where anomalyType is 'high'
            if (metrics.anomalyType === 'high') {
                history.push(metrics);
            }
        });

        if (history.length > 0) {
            // Sort history by date (Newest first) for readability
            history.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            problematicData.push({
                category: cat,
                history: history,
                // Score based on max delta found in history to float worst issues to top
                maxDelta: Math.max(...history.map(h => h.delta))
            });
        }
    });

    if (problematicData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 2rem; color: #64748b;">No high anomalies detected in the last 14 days.</td></tr>';
        return;
    }

    // Sort categories by severity (Highest Delta)
    problematicData.sort((a, b) => b.maxDelta - a.maxDelta);

    // Render
    let htmlBuffer = '';
    problematicData.forEach(item => {
        item.history.forEach(metrics => {
            // Always 'high' anomaly here due to filter
            let deltaSign = metrics.delta > 0 ? '+' : '';
            
            htmlBuffer += `
                <tr style="background-color: rgba(127, 29, 29, 0.15);">
                    <td class="category-cell">${escapeHtml(metrics.category)}</td>
                    <td style="color:#fca5a5">${metrics.date}</td>
                    <td class="text-right today-cell">${metrics.today_count}</td>
                    <td class="text-right baseline-cell">${metrics.baseline}</td>
                    <td class="text-right delta-cell delta-positive">${deltaSign}${metrics.delta}</td>
                    <td>${createAnomalyBadge(metrics)}</td>
                </tr>
            `;
        });
        // Separator
        htmlBuffer += `<tr><td colspan="6" style="background-color: #1e293b; height: 10px; padding: 0;"></td></tr>`;
    });

    tbody.innerHTML = htmlBuffer;
}

// --- Page 2: Trend Logic ---

function populateFilterOptions() {
    const categories = new Set();
    const fullCategories = Object.keys(allCategoryData);
    fullCategories.forEach(fullCat => {
        const parts = fullCat.split('::');
        if (parts.length > 0) categories.add(parts[0].trim());
    });
    
    const catSelect = document.getElementById('trend-category-filter');
    while (catSelect.options.length > 1) catSelect.remove(1);
    
    Array.from(categories).sort().forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        catSelect.appendChild(option);
    });
    updateSubcategoryOptions(); 
}

function updateSubcategoryOptions() {
    const subSelect = document.getElementById('trend-subcategory-filter');
    const currentCatFilter = filters.trendCategory;
    const currentSubFilter = filters.trendSubcategory;

    subSelect.innerHTML = '<option value="all">All Sub-categories</option>';
    const relevantSubcats = new Set();

    Object.keys(allCategoryData).forEach(fullCat => {
        const parts = fullCat.split('::');
        const mainCat = parts[0].trim();
        
        if (currentCatFilter !== 'all' && mainCat !== currentCatFilter) return;
        if (parts.length > 1) relevantSubcats.add(parts[1].trim());
    });

    Array.from(relevantSubcats).sort().forEach(sub => {
        const option = document.createElement('option');
        option.value = sub;
        option.textContent = sub;
        subSelect.appendChild(option);
    });

    // Restore selection
    let exists = false;
    for(let i=0; i<subSelect.options.length; i++){
        if(subSelect.options[i].value === currentSubFilter) exists = true;
    }
    if(exists) subSelect.value = currentSubFilter;
    else filters.trendSubcategory = 'all';
}

function renderTrendTable() {
    const tbody = document.getElementById('trend-table-body');
    const thead = document.getElementById('trend-header-row');
    
    if (availableDates.length < 2) {
        tbody.innerHTML = '<tr><td colspan="100" class="text-center" style="padding: 2rem; color: #94a3b8;">Not enough data</td></tr>';
        return;
    }

    const trendDates = availableDates.slice(0, 14);
    let headerHTML = '<th class="category-cell">Category</th><th class="text-center">% Changes</th>';
    trendDates.forEach(date => headerHTML += `<th class="trend-date-header">${date}</th>`);
    thead.innerHTML = headerHTML;

    const recentDate = trendDates[0]; 
    const prevDate = trendDates[1];   

    const visibleCategories = Object.keys(allCategoryData)
        .filter(cat => {
            const parts = cat.split('::');
            const main = parts[0].trim();
            const sub = parts.length > 1 ? parts[1].trim() : '';
            if (filters.trendCategory !== 'all' && main !== filters.trendCategory) return false;
            if (filters.trendSubcategory !== 'all' && sub !== filters.trendSubcategory) return false;
            return true;
        })
        .sort((a, b) => (allCategoryData[b][recentDate] || 0) - (allCategoryData[a][recentDate] || 0));

    let rowsHTML = '';
    if (visibleCategories.length === 0) {
        rowsHTML = '<tr><td colspan="100" class="text-center" style="padding: 2rem; color: #64748b;">No data matches filters</td></tr>';
    } else {
        visibleCategories.forEach(category => {
            const dateMap = allCategoryData[category];
            const recentCount = dateMap[recentDate] || 0;
            const prevCount = (prevDate && dateMap[prevDate]) ? dateMap[prevDate] : 0;
            
            let changeHTML = '<span class="change-neutral">-</span>';
            let percent = 0;

            if (prevCount > 0) {
                percent = Math.round(((recentCount - prevCount) / prevCount) * 100);
                if (percent > 0) changeHTML = `<span class="change-positive">🔴 ↑ ${percent}%</span>`;
                else if (percent < 0) changeHTML = `<span class="change-negative">🟢 ↓ ${Math.abs(percent)}%</span>`;
                else changeHTML = `<span class="change-neutral">0%</span>`;
            } else if (recentCount > 0) {
                 changeHTML = `<span class="change-positive">🔴 New</span>`;
            } else {
                 changeHTML = `<span class="change-neutral">0%</span>`;
            }

            let dateCells = '';
            trendDates.forEach(date => {
                const count = dateMap[date] || 0;
                const isHead = date === recentDate;
                const cellStyle = isHead ? 'font-weight:bold; color:#f1f5f9; background-color: rgba(59, 130, 246, 0.1);' : '';
                dateCells += `<td class="trend-val" style="${cellStyle}">${count}</td>`;
            });

            rowsHTML += `<tr><td class="category-cell">${escapeHtml(category)}</td><td>${changeHTML}</td>${dateCells}</tr>`;
        });
    }
    tbody.innerHTML = rowsHTML;
}

// --- Utilities ---
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function createAnomalyBadge(item) {
    if (!item.isAnomaly) {
        return `<div class="badge badge-normal"><svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>Normal</span></div>`;
    }
    if (item.anomalyType === 'high') {
        return `<div class="badge badge-high"><svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg><span>High Anomaly</span><span class="badge-percent">+${item.percentChange}%</span></div>`;
    }
    return `<div class="badge badge-low"><svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg><span>Low Anomaly</span><span class="badge-percent">${item.percentChange}%</span></div>`;
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}
