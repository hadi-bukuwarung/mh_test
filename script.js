// Global state
let allCategoryData = {}; 
let allChannelData = {}; 
let allWeeklyData = {}; 
let allStatusData = {}; 
let allRawRows = []; 
let allDatesSet = new Set();
let availableDates = []; 
let availableWeeks = []; 
let currentDate = null;
let tableData = [];
let sortConfig = { key: 'today_count', direction: 'desc' };

// Filters
let filters = {
    date: null,
    status: 'all',
    trendCategory: 'all',
    trendSubcategory: 'all',
    weeklyCategory: 'all',
    weeklySubcategory: 'all',
    healthStatus: 'all_non_closed',
    globalSource: 'all'
};

document.addEventListener('DOMContentLoaded', function() {
    fetchExternalMetadata(); 
    loadAndProcessData();
    setupEventListeners();
});

async function fetchExternalMetadata() {
    const label = document.getElementById('last-updated');
    try {
        const response = await fetch('metadata.json');
        if (!response.ok) throw new Error('Metadata file missing');
        const data = await response.json();
        if (data.last_updated) {
            const dateObj = new Date(data.last_updated);
            if (!isNaN(dateObj.getTime())) {
                label.textContent = `Data as of: ${dateObj.toLocaleString('en-US', { 
                    year: 'numeric', month: 'short', day: 'numeric', 
                    hour: '2-digit', minute: '2-digit' 
                })}`;
                return; 
            }
        }
        throw new Error('Invalid metadata format');
    } catch (err) {
        try {
            const csvResponse = await fetch('zoho_ticket.csv', { method: 'HEAD' });
            const lastMod = csvResponse.headers.get('Last-Modified');
            if (lastMod) {
                const dateObj = new Date(lastMod);
                label.textContent = `Data as of: ${dateObj.toLocaleString('en-US', { 
                    year: 'numeric', month: 'short', day: 'numeric', 
                    hour: '2-digit', minute: '2-digit' 
                })}`;
            } else {
                label.textContent = 'Data update time unknown';
            }
        } catch (e) {
            label.textContent = 'Data update time unknown';
        }
    }
}

function setupEventListeners() {
    document.getElementById('global-source-filter').addEventListener('change', function(e) {
        filters.globalSource = e.target.value;
        aggregateData(); 
        refreshCurrentView();
    });

    document.getElementById('dashboard-date-picker').addEventListener('change', function(e) {
        const selectedDate = e.target.value;
        // Allow selecting any date even if not in set (might be empty day)
        filters.date = selectedDate;
        
        // Update UI text
        const [y, m, d] = selectedDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        document.getElementById('current-date').textContent = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        updateTableForDate(selectedDate);
    });

    const headers = document.querySelectorAll('#data-table th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.getAttribute('data-sort');
            sortData(sortKey);
        });
    });
    
    document.getElementById('status-filter').addEventListener('change', function(e) {
        filters.status = e.target.value;
        renderTable();
    });

    document.getElementById('trend-category-filter').addEventListener('change', function(e) {
        filters.trendCategory = e.target.value;
        filters.trendSubcategory = 'all';
        document.getElementById('trend-subcategory-filter').value = 'all';
        updateSubcategoryOptions('trend');
        renderTrendTable();
    });

    document.getElementById('trend-subcategory-filter').addEventListener('change', function(e) {
        filters.trendSubcategory = e.target.value;
        renderTrendTable();
    });

    document.getElementById('weekly-category-filter').addEventListener('change', function(e) {
        filters.weeklyCategory = e.target.value;
        filters.weeklySubcategory = 'all';
        document.getElementById('weekly-subcategory-filter').value = 'all';
        updateSubcategoryOptions('weekly');
        renderWeeklyTable();
    });

    document.getElementById('weekly-subcategory-filter').addEventListener('change', function(e) {
        filters.weeklySubcategory = e.target.value;
        renderWeeklyTable();
    });

    document.getElementById('health-status-filter').addEventListener('change', function(e) {
        filters.healthStatus = e.target.value;
        renderStatusHealthTable();
    });

    document.getElementById('tab-dashboard').addEventListener('click', () => switchTab('dashboard'));
    document.getElementById('tab-trends').addEventListener('click', () => switchTab('trends'));
    document.getElementById('tab-weekly').addEventListener('click', () => switchTab('weekly'));
    document.getElementById('tab-channel').addEventListener('click', () => switchTab('channel'));
    document.getElementById('tab-status').addEventListener('click', () => switchTab('status'));
    document.getElementById('tab-feed').addEventListener('click', () => switchTab('feed'));
}

function refreshCurrentView() {
    const activeBtn = document.querySelector('.nav-btn.active');
    if (activeBtn) activeBtn.click();
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    const views = ['view-dashboard', 'view-trends', 'view-weekly', 'view-channel', 'view-status', 'view-feed'];
    views.forEach(id => document.getElementById(id).style.display = 'none');

    if (tabName === 'dashboard') {
        document.getElementById('view-dashboard').style.display = 'block';
        if (filters.date) updateTableForDate(filters.date); 
    } else if (tabName === 'trends') {
        document.getElementById('view-trends').style.display = 'block';
        if (availableDates.length > 0) renderTrendTable();
    } else if (tabName === 'weekly') {
        document.getElementById('view-weekly').style.display = 'block';
        if (availableWeeks.length > 0) renderWeeklyTable();
    } else if (tabName === 'channel') {
        document.getElementById('view-channel').style.display = 'block';
        if (availableDates.length > 0) renderChannelTable();
    } else if (tabName === 'status') {
        document.getElementById('view-status').style.display = 'block';
        if (availableDates.length > 0) renderStatusHealthTable();
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

function normalizeDate(rawStr) {
    if (!rawStr) return null;
    let datePart = rawStr.split(' ')[0].trim();
    datePart = datePart.replace(/\//g, '-');
    const parts = datePart.split('-');
    if (parts.length !== 3) return null;

    let y = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    let d = parseInt(parts[2], 10);

    if (y < 100 && d > 1000) {
        const temp = y; y = d; d = temp;
    }

    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function processAggregatedData(rows, headers) {
    if (!rows || rows.length === 0) throw new Error("CSV file is empty");

    const findHeader = (target) => {
        if (!headers) return null;
        const match = headers.find(h => h.trim().toLowerCase().replace(/^[\uFEFF\n\r]+/, '') === target.toLowerCase());
        return match || null; 
    };

    const catCol = findHeader('real_category');
    const dateCol = findHeader('Created Time') || findHeader('created time') || findHeader('Last Update Time') || findHeader('date') || findHeader('Date') || findHeader('time');
    const countCol = findHeader('num_of_ticket');
    const channelCol = findHeader('channel') || findHeader('Channel');
    const statusCol = findHeader('status') || findHeader('Status');

    if (!catCol) throw new Error(`Missing 'real_category' column.`);
    if (!dateCol) throw new Error(`Missing Date column.`);

    allRawRows = []; 

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let category = row[catCol];
        
        const dateStr = normalizeDate(row[dateCol]);
        const channel = channelCol ? (row[channelCol] || 'Unknown') : 'Unknown';
        const status = statusCol ? (row[statusCol] || 'Open') : 'Open';
        let count = 1;

        if (countCol && row[countCol]) {
            const parsedCount = parseInt(row[countCol], 10);
            if (!isNaN(parsedCount)) {
                count = parsedCount;
            }
        }

        if (!category || category.trim() === '') {
            category = 'Uncategorized';
        }

        if (!dateStr) continue; 

        allRawRows.push({
            category: category,
            date: dateStr,
            status: status, 
            channel: channel,
            count: count
        });
    }
    
    if (allRawRows.length === 0) {
        throw new Error("No valid rows parsed. Check date format.");
    }

    aggregateData();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'block';
}

function aggregateData() {
    allCategoryData = {};
    allChannelData = {};
    allStatusData = {};
    allDatesSet = new Set();
    allWeeklyData = {};
    let weeklySet = new Set();
    let totalTicketsLoaded = 0;
    let rowsSkipped = 0;

    const getSunday = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day; 
        return new Date(date.setDate(diff));
    };

    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const includeClosed = filters.globalSource === 'all';

    for (const row of allRawRows) {
        const statusLower = row.status.toLowerCase();
        const isClosed = statusLower.includes('closed');

        // Global Filter logic: if "non_closed", skip closed rows
        if (!includeClosed && isClosed) {
            rowsSkipped += row.count; // Count skipped tickets for debug
            continue;
        }

        const { category, date: dateStr, channel, count, status } = row;

        totalTicketsLoaded += count;
        allDatesSet.add(dateStr);
        
        // Initialize or Sum Category Data
        if (!allCategoryData[category]) allCategoryData[category] = {};
        if (!allCategoryData[category][dateStr]) allCategoryData[category][dateStr] = 0;
        allCategoryData[category][dateStr] += count; // SUMMING logic

        // Initialize or Sum Channel Data
        if (!allChannelData[channel]) allChannelData[channel] = {};
        if (!allChannelData[channel][dateStr]) allChannelData[channel][dateStr] = 0;
        allChannelData[channel][dateStr] += count;

        // Status Data
        if (!allStatusData[dateStr]) allStatusData[dateStr] = { total: 0, open: 0, pending: 0, closed: 0 };
        allStatusData[dateStr].total += count;
        
        let normalizedStatus = 'Pending'; 
        if (statusLower === 'open') normalizedStatus = 'Open';
        else if (statusLower === 'closed') normalizedStatus = 'Closed';

        if (normalizedStatus === 'Open') allStatusData[dateStr].open += count;
        else if (normalizedStatus === 'Closed') allStatusData[dateStr].closed += count;
        else allStatusData[dateStr].pending += count;

        // Weekly Data
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        const sundayObj = getSunday(dateObj);
        const weekStr = formatDate(sundayObj);

        weeklySet.add(weekStr);
        if (!allWeeklyData[category]) allWeeklyData[category] = {};
        if (!allWeeklyData[category][weekStr]) allWeeklyData[category][weekStr] = 0;
        allWeeklyData[category][weekStr] += count;
    }

    // Debug Info
    const totalEl = document.getElementById('total-count-display');
    if (totalEl) {
        const filterText = includeClosed ? "(All)" : "(Active Only)";
        totalEl.textContent = `Tickets: ${totalTicketsLoaded.toLocaleString()} ${filterText}`;
        // Optional: Warn if huge discrepancy
    }

    availableDates = Array.from(allDatesSet).sort().reverse(); 
    availableWeeks = Array.from(weeklySet).sort().reverse();

    if (availableDates.length === 0) {
        currentDate = null;
        document.getElementById('current-date').textContent = "No Data Available";
        return; 
    }

    populateFilterOptions('trend');
    populateFilterOptions('weekly');

    // Preserve selected date if valid, else default to latest
    if (!filters.date || !allDatesSet.has(filters.date)) {
        filters.date = availableDates[0];
    }

    const latestDate = filters.date;
    
    // Update Date Picker Constraints
    const datePicker = document.getElementById('dashboard-date-picker');
    if (datePicker) {
        datePicker.max = availableDates[0];
        datePicker.min = availableDates[availableDates.length - 1];
        datePicker.value = latestDate;
    }

    try {
        const [y, m, d] = latestDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        document.getElementById('current-date').textContent = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
        document.getElementById('current-date').textContent = latestDate;
    }

    updateStatusScorecard(latestDate);
    updateTableForDate(latestDate);
}

// ... (Rest of file same as before) ...

function updateStatusScorecard(dateStr) {
    const stats = allStatusData[dateStr] || { total: 0, open: 0, pending: 0, closed: 0 };
    const getPercent = (val) => {
        if (stats.total === 0) return '0%';
        return Math.round((val / stats.total) * 100) + '%';
    };
    document.getElementById('health-open').textContent = getPercent(stats.open);
    document.getElementById('health-pending').textContent = getPercent(stats.pending);
    document.getElementById('health-closed').textContent = getPercent(stats.closed);
    document.getElementById('health-open').style.color = stats.open > 0 ? '#fca5a5' : '#f1f5f9';
    document.getElementById('health-closed').style.color = '#4ade80'; 
    document.getElementById('health-pending').style.color = '#fde047'; 
}

function renderStatusHealthTable() {
    const tbody = document.getElementById('health-table-body');
    const includeClosed = filters.globalSource === 'all';
    const filteredRows = allRawRows.filter(row => {
        const statusLower = row.status.toLowerCase();
        const isClosed = statusLower.includes('closed');
        if (!includeClosed && isClosed) return false;
        if (isClosed) return false; 
        if (filters.healthStatus === 'open') return statusLower === 'open';
        else if (filters.healthStatus === 'pending') return statusLower !== 'open'; 
        return true;
    });

    if (filteredRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 2rem; color: #64748b;">No tickets match criteria</td></tr>';
        return;
    }

    filteredRows.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA;
    });

    const displayRows = filteredRows.slice(0, 500); 
    let htmlBuffer = '';
    displayRows.forEach(row => {
        const statusLower = row.status.toLowerCase();
        let statusColor = '#f1f5f9';
        if (statusLower === 'open') statusColor = '#fca5a5';
        else if (!statusLower.includes('closed')) statusColor = '#fde047'; 
        htmlBuffer += `<tr><td class="category-cell">${escapeHtml(row.category)}</td><td>${row.date}</td><td style="color: ${statusColor}; font-weight: 600;">${escapeHtml(row.status)}</td><td class="text-right">${row.count}</td></tr>`;
    });
    if (filteredRows.length > 500) htmlBuffer += `<tr><td colspan="4" class="text-center" style="padding: 1rem; color: #64748b;">...and ${filteredRows.length - 500} more</td></tr>`;
    tbody.innerHTML = htmlBuffer;
}

function populateFilterOptions(viewType) {
    const categories = new Set();
    const sourceData = viewType === 'weekly' ? allWeeklyData : allCategoryData;
    const fullCategories = Object.keys(sourceData);
    fullCategories.forEach(fullCat => {
        const parts = fullCat.split('::');
        if (parts.length > 0) categories.add(parts[0].trim());
    });
    const selectId = viewType === 'weekly' ? 'weekly-category-filter' : 'trend-category-filter';
    const catSelect = document.getElementById(selectId);
    while (catSelect.options.length > 1) catSelect.remove(1);
    Array.from(categories).sort().forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        catSelect.appendChild(option);
    });
    updateSubcategoryOptions(viewType); 
}

function updateSubcategoryOptions(viewType) {
    const selectId = viewType === 'weekly' ? 'weekly-subcategory-filter' : 'trend-subcategory-filter';
    const subSelect = document.getElementById(selectId);
    const currentCatFilter = viewType === 'weekly' ? filters.weeklyCategory : filters.trendCategory;
    const currentSubFilter = viewType === 'weekly' ? filters.weeklySubcategory : filters.trendSubcategory;
    subSelect.innerHTML = '<option value="all">All Sub-categories</option>';
    const relevantSubcats = new Set();
    const sourceData = viewType === 'weekly' ? allWeeklyData : allCategoryData;
    Object.keys(sourceData).forEach(fullCat => {
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
    let exists = false;
    for(let i=0; i<subSelect.options.length; i++){
        if(subSelect.options[i].value === currentSubFilter) exists = true;
    }
    if(exists) subSelect.value = currentSubFilter;
    else {
        if (viewType === 'weekly') filters.weeklySubcategory = 'all';
        else filters.trendSubcategory = 'all';
    }
}

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
    return { category, date: dateStr, today_count: todayCount, baseline, delta, isAnomaly, anomalyType, percentChange };
}

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
        if (th.getAttribute('data-sort') === sortConfig.key) th.classList.add(sortConfig.direction);
    });
    tableData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        if (key === 'category') return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
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
        htmlBuffer += `<tr><td class="category-cell">${escapeHtml(item.category)}</td><td class="text-right today-cell">${item.today_count}</td><td class="text-right baseline-cell">${item.baseline}</td><td class="text-right delta-cell ${deltaClass}">${deltaSign}${item.delta}</td><td>${createAnomalyBadge(item)}</td></tr>`;
    });
    tbody.innerHTML = htmlBuffer;
}

function renderAnomalyFeed() {
    const tbody = document.getElementById('feed-table-body');
    const historyWindow = 60; // Set to 60 to catch 2025-10-20
    if (availableDates.length === 0) return;
    const dates = availableDates.slice(0, historyWindow); 
    const allAnomalies = []; 
    const categories = Object.keys(allCategoryData);
    categories.forEach(cat => {
        dates.forEach((date) => {
            const metrics = getMetricsForDate(cat, date);
            if (metrics.anomalyType === 'high') allAnomalies.push(metrics);
        });
    });
    if (allAnomalies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 2rem; color: #64748b;">No high anomalies detected in the last 60 days.</td></tr>';
        return;
    }
    allAnomalies.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateB.getTime() !== dateA.getTime()) return dateB - dateA; 
        return b.delta - a.delta; 
    });
    let htmlBuffer = '';
    allAnomalies.forEach(metrics => {
        let deltaClass = 'delta-positive';
        let deltaSign = metrics.delta > 0 ? '+' : '';
        htmlBuffer += `<tr style="background-color: rgba(127, 29, 29, 0.15);"><td class="category-cell">${escapeHtml(metrics.category)}</td><td style="color:#fca5a5">${metrics.date}</td><td class="text-right today-cell">${metrics.today_count}</td><td class="text-right baseline-cell">${metrics.baseline}</td><td class="text-right delta-cell ${deltaClass}">${deltaSign}${metrics.delta}</td><td>${createAnomalyBadge(metrics)}</td></tr>`;
    });
    tbody.innerHTML = htmlBuffer;
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
    const visibleCategories = Object.keys(allCategoryData).filter(cat => {
        const parts = cat.split('::');
        const main = parts[0].trim();
        const sub = parts.length > 1 ? parts[1].trim() : '';
        if (filters.trendCategory !== 'all' && main !== filters.trendCategory) return false;
        if (filters.trendSubcategory !== 'all' && sub !== filters.trendSubcategory) return false;
        return true;
    }).sort((a, b) => (allCategoryData[b][recentDate] || 0) - (allCategoryData[a][recentDate] || 0));
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
            } else if (recentCount > 0) changeHTML = `<span class="change-positive">🔴 New</span>`;
            else changeHTML = `<span class="change-neutral">0%</span>`;
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

function renderWeeklyTable() {
    const tbody = document.getElementById('weekly-table-body');
    const thead = document.getElementById('weekly-header-row');
    if (availableWeeks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100" class="text-center" style="padding: 2rem; color: #94a3b8;">Not enough weekly data</td></tr>';
        return;
    }
    const trendWeeks = availableWeeks.slice(0, 12);
    let headerHTML = '<th class="category-cell">Category</th><th class="text-center">% Changes</th>';
    trendWeeks.forEach((week, index) => {
        const label = index === 0 ? `${week} (Latest)` : week;
        headerHTML += `<th class="trend-date-header">${label}</th>`;
    });
    thead.innerHTML = headerHTML;
    const recentWeek = trendWeeks[0]; 
    const prevWeek = trendWeeks[1];   
    const visibleCategories = Object.keys(allWeeklyData).filter(cat => {
        const parts = cat.split('::');
        const main = parts[0].trim();
        const sub = parts.length > 1 ? parts[1].trim() : '';
        if (filters.weeklyCategory !== 'all' && main !== filters.weeklyCategory) return false;
        if (filters.weeklySubcategory !== 'all' && sub !== filters.weeklySubcategory) return false;
        return true;
    }).sort((a, b) => (allWeeklyData[b][recentWeek] || 0) - (allWeeklyData[a][recentWeek] || 0));
    let rowsHTML = '';
    if (visibleCategories.length === 0) {
        rowsHTML = '<tr><td colspan="100" class="text-center" style="padding: 2rem; color: #64748b;">No data matches filters</td></tr>';
    } else {
        visibleCategories.forEach(category => {
            const weekMap = allWeeklyData[category];
            const recentCount = weekMap[recentWeek] || 0;
            const prevCount = (prevWeek && weekMap[prevWeek]) ? weekMap[prevWeek] : 0;
            let changeHTML = '<span class="change-neutral">-</span>';
            let percent = 0;
            if (prevCount > 0) {
                percent = Math.round(((recentCount - prevCount) / prevCount) * 100);
                if (percent > 0) changeHTML = `<span class="change-positive">🔴 ↑ ${percent}%</span>`;
                else if (percent < 0) changeHTML = `<span class="change-negative">🟢 ↓ ${Math.abs(percent)}%</span>`;
                else changeHTML = `<span class="change-neutral">0%</span>`;
            } else if (recentCount > 0) changeHTML = `<span class="change-positive">🔴 New</span>`;
            else changeHTML = `<span class="change-neutral">0%</span>`;
            let dateCells = '';
            trendWeeks.forEach((week, index) => {
                const count = weekMap[week] || 0;
                const isHead = index === 0; 
                const cellStyle = isHead ? 'font-weight:bold; color:#f1f5f9; background-color: rgba(59, 130, 246, 0.1);' : '';
                dateCells += `<td class="trend-val" style="${cellStyle}">${count}</td>`;
            });
            rowsHTML += `<tr><td class="category-cell">${escapeHtml(category)}</td><td>${changeHTML}</td>${dateCells}</tr>`;
        });
    }
    tbody.innerHTML = rowsHTML;
}

function renderChannelTable() {
    const tbody = document.getElementById('channel-table-body');
    const thead = document.getElementById('channel-header-row');
    if (availableDates.length < 2) {
        tbody.innerHTML = '<tr><td colspan="100" class="text-center" style="padding: 2rem; color: #94a3b8;">Not enough data</td></tr>';
        return;
    }
    const trendDates = availableDates.slice(0, 14);
    let headerHTML = '<th class="category-cell">Channel</th><th class="text-center">% Changes</th>';
    trendDates.forEach(date => headerHTML += `<th class="trend-date-header">${date}</th>`);
    thead.innerHTML = headerHTML;
    const recentDate = trendDates[0]; 
    const prevDate = trendDates[1];   
    const channels = Object.keys(allChannelData).sort((a, b) => (allChannelData[b][recentDate] || 0) - (allChannelData[a][recentDate] || 0));
    let rowsHTML = '';
    channels.forEach(channel => {
        const dateMap = allChannelData[channel];
        const recentCount = dateMap[recentDate] || 0;
        const prevCount = (prevDate && dateMap[prevDate]) ? dateMap[prevDate] : 0;
        let changeHTML = '<span class="change-neutral">-</span>';
        let percent = 0;
        if (prevCount > 0) {
            percent = Math.round(((recentCount - prevCount) / prevCount) * 100);
            if (percent > 0) changeHTML = `<span class="change-positive">🔴 ↑ ${percent}%</span>`;
            else if (percent < 0) changeHTML = `<span class="change-negative">🟢 ↓ ${Math.abs(percent)}%</span>`;
            else changeHTML = `<span class="change-neutral">0%</span>`;
        } else if (recentCount > 0) changeHTML = `<span class="change-positive">🔴 New</span>`;
        else changeHTML = `<span class="change-neutral">0%</span>`;
        let dateCells = '';
        trendDates.forEach(date => {
            const count = dateMap[date] || 0;
            const isHead = date === recentDate;
            const cellStyle = isHead ? 'font-weight:bold; color:#f1f5f9; background-color: rgba(59, 130, 246, 0.1);' : '';
            dateCells += `<td class="trend-val" style="${cellStyle}">${count}</td>`;
        });
        rowsHTML += `<tr><td class="category-cell">${escapeHtml(channel)}</td><td>${changeHTML}</td>${dateCells}</tr>`;
    });
    tbody.innerHTML = rowsHTML;
}

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
