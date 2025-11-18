// Global state
let allCategoryData = {}; // Store all date data for each category
let availableDates = [];
let currentDate = null;
let tableData = [];
let sortConfig = { key: 'today_count', direction: 'desc' };
let filters = {
    date: null,
    status: 'all'
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Set header date to today initially
    const today = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = today.toLocaleDateString('en-US', options);
    
    loadAndProcessData();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.getAttribute('data-sort');
            sortData(sortKey);
        });
    });
    
    // Status filter
    document.getElementById('status-filter').addEventListener('change', function(e) {
        filters.status = e.target.value;
        renderTable();
    });
}

// Load and process CSV data
function loadAndProcessData() {
    Papa.parse('zoho_ticket.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            try {
                processData(results.data);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('content').style.display = 'block';
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

function processData(data) {
    // 1. Group by Category and Date
    const categoryDateMap = {};
    const allDatesSet = new Set();

    data.forEach(row => {
        const category = row['real_category'];
        const createdTime = row['Created Time'];
        
        if (category && createdTime) {
            // Extract YYYY-MM-DD
            try {
                const dateObj = new Date(createdTime);
                if (!isNaN(dateObj.getTime())) {
                    const dateStr = dateObj.toISOString().split('T')[0];
                    allDatesSet.add(dateStr);

                    if (!categoryDateMap[category]) {
                        categoryDateMap[category] = {};
                    }
                    if (!categoryDateMap[category][dateStr]) {
                        categoryDateMap[category][dateStr] = 0;
                    }
                    categoryDateMap[category][dateStr]++;
                }
            } catch (e) {
                // Ignore invalid dates
            }
        }
    });

    // 2. Store global state
    availableDates = Array.from(allDatesSet).sort((a, b) => new Date(b) - new Date(a));
    allCategoryData = categoryDateMap;

    if (availableDates.length === 0) {
        throw new Error("No valid dates found in data");
    }

    // 3. Select latest date automatically (No filter UI population needed)
    const latestDate = availableDates[0];
    filters.date = latestDate;
    updateTableForDate(latestDate);
}

function updateTableForDate(dateStr) {
    currentDate = dateStr;
    
    // Update column header
    document.getElementById('date-column-header').textContent = `Count (${dateStr})`;
    document.getElementById('current-date').textContent = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const processedData = [];
    const categories = Object.keys(allCategoryData);

    categories.forEach(category => {
        const counts = allCategoryData[category];
        const todayCount = counts[dateStr] || 0;

        // Calculate Baseline (Moving Average of last 21 days inclusive)
        let totalCount = 0;
        let daysCounted = 0;
        
        // Look back 21 days
        const current = new Date(dateStr);
        for (let i = 0; i < 21; i++) {
            const d = new Date(current);
            d.setDate(d.getDate() - i);
            const lookbackDateStr = d.toISOString().split('T')[0];
            
            totalCount += (counts[lookbackDateStr] || 0);
            daysCounted++;
        }

        const baseline = daysCounted > 0 ? totalCount / daysCounted : 0;
        const delta = todayCount - baseline;
        
        // Anomaly Logic
        let status = 'Normal';
        let isAnomaly = false;
        let anomalyType = null;
        let percentChange = 0;

        if (baseline > 0) {
            percentChange = ((todayCount - baseline) / baseline) * 100;
        } else if (todayCount > 0) {
            percentChange = 100; // Infinite increase technically
        }

        // Rule: Today's count exceeds baseline by >50% OR >10 tickets
        if (todayCount > baseline * 1.5 || todayCount > baseline + 10) {
            status = 'High Anomaly';
            isAnomaly = true;
            anomalyType = 'high';
        } 
        // Low Anomaly: <70% of baseline
        else if (todayCount < baseline * 0.7) {
            status = 'Low Anomaly';
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
    
    // Apply current sort
    sortData(sortConfig.key, false); // false = don't toggle direction
}

function sortData(key, toggle = true) {
    if (toggle) {
        if (sortConfig.key === key) {
            sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortConfig.key = key;
            sortConfig.direction = 'desc'; // Default to desc for numbers usually
            if (key === 'category') sortConfig.direction = 'asc';
        }
    }

    // Update header classes
    document.querySelectorAll('th').forEach(th => {
        th.classList.remove('asc', 'desc');
        if (th.getAttribute('data-sort') === sortConfig.key) {
            th.classList.add(sortConfig.direction);
        }
    });

    tableData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        // String sort for category
        if (key === 'category') {
            return sortConfig.direction === 'asc' 
                ? valA.localeCompare(valB) 
                : valB.localeCompare(valA);
        }

        // Numeric sort
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

    filteredData.forEach(item => {
        const tr = document.createElement('tr');
        
        // Delta Color
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
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Create anomaly badge
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

// Show error
function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}
