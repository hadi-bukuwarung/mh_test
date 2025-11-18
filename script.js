// Global state
let tableData = [];
let sortConfig = { key: 'delta', direction: 'desc' };

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
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
}

// Load and process CSV data
function loadAndProcessData() {
    Papa.parse('zoho_ticket.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            if (results.errors.length > 0) {
                showError('Error parsing CSV file: ' + results.errors[0].message);
                return;
            }
            
            try {
                const processedData = processCSVData(results.data);
                tableData = processedData;
                renderDashboard();
                hideLoading();
            } catch (error) {
                showError('Error processing data: ' + error.message);
            }
        },
        error: function(error) {
            showError('Error loading CSV file: ' + error.message);
        }
    });
}

// Process CSV data
function processCSVData(tickets) {
    // Build time series for each category
    const categorySeries = {};
    let maxDate = null;

    tickets.forEach(ticket => {
        // Extract date from Created Time
        const dateMatch = ticket['Created Time'] ? ticket['Created Time'].match(/(\d{4}-\d{2}-\d{2})/) : null;
        if (!dateMatch) return;
        
        const date = dateMatch[1];
        const category = ticket['real_category'];

        if (!category) return;

        // Track maximum date
        if (!maxDate || date > maxDate) {
            maxDate = date;
        }

        // Initialize category if needed
        if (!categorySeries[category]) {
            categorySeries[category] = {};
        }
        
        // Count tickets per day
        categorySeries[category][date] = (categorySeries[category][date] || 0) + 1;
    });

    // Calculate metrics for each category
    const results = [];
    
    Object.keys(categorySeries).forEach(category => {
        const series = categorySeries[category];
        const dates = Object.keys(series).sort();
        
        // Calculate 21-day moving average
        const baseline = calculateMovingAverage(series, dates, maxDate, 21);
        const todayCount = series[maxDate] || 0;
        const delta = todayCount - baseline;
        
        // Anomaly detection rules
        const isHighAnomaly = (delta > baseline * 0.5) || (delta > 10);
        const isLowAnomaly = (baseline > 0 && todayCount < baseline * 0.7);
        const isAnomaly = isHighAnomaly || isLowAnomaly;
        
        let anomalyType = 'normal';
        if (isHighAnomaly) anomalyType = 'high';
        else if (isLowAnomaly) anomalyType = 'low';

        const percentChange = baseline > 0 ? Math.round((delta / baseline) * 100) : 0;

        results.push({
            category: category,
            today_count: todayCount,
            baseline: Math.round(baseline * 10) / 10,
            delta: Math.round(delta * 10) / 10,
            isAnomaly: isAnomaly,
            anomalyType: anomalyType,
            percentChange: percentChange
        });
    });

    return results;
}

// Calculate moving average
function calculateMovingAverage(series, dates, targetDate, windowSize) {
    const targetIndex = dates.indexOf(targetDate);
    if (targetIndex === -1) return 0;

    const startIndex = Math.max(0, targetIndex - windowSize + 1);
    const relevantDates = dates.slice(startIndex, targetIndex + 1);
    
    const sum = relevantDates.reduce((acc, date) => acc + (series[date] || 0), 0);
    return sum / relevantDates.length;
}

// Sort data
function sortData(key) {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
        direction = 'desc';
    }
    sortConfig = { key, direction };
    
    renderTable();
    updateSortIndicators();
}

// Get sorted data
function getSortedData() {
    return [...tableData].sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        
        // Handle string comparison for category
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        if (aVal < bVal) {
            return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
            return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });
}

// Update sort indicators
function updateSortIndicators() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
        const arrow = header.querySelector('.sort-arrow');
        const sortKey = header.getAttribute('data-sort');
        
        header.classList.remove('sorted');
        arrow.textContent = '';
        
        if (sortKey === sortConfig.key) {
            header.classList.add('sorted');
            arrow.textContent = sortConfig.direction === 'asc' ? '↑' : '↓';
        }
    });
}

// Render dashboard
function renderDashboard() {
    // Update statistics
    const totalCategories = tableData.length;
    const anomalyCount = tableData.filter(item => item.isAnomaly).length;
    const anomalyRate = totalCategories > 0 ? Math.round((anomalyCount / totalCategories) * 100) : 0;
    
    document.getElementById('total-categories').textContent = totalCategories;
    document.getElementById('anomaly-count').textContent = anomalyCount;
    document.getElementById('anomaly-rate').textContent = anomalyRate + '%';
    
    // Render table
    renderTable();
    updateSortIndicators();
}

// Render table
function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    const sortedData = getSortedData();
    
    sortedData.forEach(item => {
        const row = document.createElement('tr');
        if (item.isAnomaly) {
            row.classList.add('anomaly-row');
        }
        
        // Category
        const categoryCell = document.createElement('td');
        categoryCell.classList.add('category-cell');
        categoryCell.textContent = item.category;
        row.appendChild(categoryCell);
        
        // Today count
        const todayCell = document.createElement('td');
        todayCell.classList.add('today-cell', 'text-right');
        todayCell.textContent = item.today_count;
        row.appendChild(todayCell);
        
        // Baseline
        const baselineCell = document.createElement('td');
        baselineCell.classList.add('baseline-cell', 'text-right');
        baselineCell.textContent = item.baseline;
        row.appendChild(baselineCell);
        
        // Delta
        const deltaCell = document.createElement('td');
        deltaCell.classList.add('delta-cell', 'text-right');
        if (item.delta > 0) {
            deltaCell.classList.add('delta-positive');
            deltaCell.textContent = '+' + item.delta;
        } else if (item.delta < 0) {
            deltaCell.classList.add('delta-negative');
            deltaCell.textContent = item.delta;
        } else {
            deltaCell.classList.add('delta-neutral');
            deltaCell.textContent = item.delta;
        }
        row.appendChild(deltaCell);
        
        // Anomaly badge
        const badgeCell = document.createElement('td');
        badgeCell.appendChild(createAnomalyBadge(item));
        row.appendChild(badgeCell);
        
        tbody.appendChild(row);
    });
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
    } else if (item.anomalyType === 'high') {
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
    
    return badge;
}

// Show error
function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}

// Hide loading
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
}
