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
    // Set current date
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
    
    // Date filter
    document.getElementById('date-filter').addEventListener('change', function(e) {
        filters.date = e.target.value;
        updateTableForDate(e.target.value);
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
        worker: true, // Use web worker for better performance
        chunk: function(results, parser) {
            // Process data in chunks for better performance
            if (!window.ticketChunks) {
                window.ticketChunks = [];
            }
            window.ticketChunks.push(...results.data);
        },
        complete: function(results) {
            if (results.errors.length > 0) {
                showError('Error parsing CSV file: ' + results.errors[0].message);
                return;
            }
            
            try {
                const allData = window.ticketChunks || results.data;
                delete window.ticketChunks;
                
                // Use requestIdleCallback for non-blocking processing
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(() => {
                        processAndRender(allData);
                    });
                } else {
                    setTimeout(() => processAndRender(allData), 0);
                }
            } catch (error) {
                showError('Error processing data: ' + error.message);
            }
        },
        error: function(error) {
            showError('Error loading CSV file: ' + error.message);
        }
    });
}

function processAndRender(tickets) {
    const processedData = processCSVData(tickets);
    tableData = processedData;
    renderDashboard();
    hideLoading();
}

// Process CSV data
function processCSVData(tickets) {
    // Build time series for each category
    const categorySeries = {};
    let maxDate = null;
    const dateSet = new Set();

    // Single pass through tickets
    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const createdTime = ticket['Created Time'];
        const category = ticket['real_category'];
        
        if (!createdTime || !category) continue;
        
        // Extract date more efficiently
        const date = createdTime.substring(0, 10); // Get YYYY-MM-DD
        
        dateSet.add(date);

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
    }

    // Store all dates and sort them (already in Set, so unique)
    availableDates = Array.from(dateSet).sort().reverse();
    currentDate = maxDate;
    
    // Store all category data
    allCategoryData = categorySeries;
    
    // Populate date filter
    populateDateFilter(availableDates, maxDate);
    
    // Update column header
    updateDateColumnHeader(maxDate);
    
    // Calculate metrics for max date
    return calculateMetricsForDate(categorySeries, maxDate);
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

// Calculate metrics for a specific date
function calculateMetricsForDate(categorySeries, targetDate) {
    const results = [];
    const categories = Object.keys(categorySeries);
    
    // Pre-sort dates once for all categories
    const allDates = {};
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        allDates[category] = Object.keys(categorySeries[category]).sort();
    }
    
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const series = categorySeries[category];
        const dates = allDates[category];
        
        // Calculate 21-day moving average
        const baseline = calculateMovingAverage(series, dates, targetDate, 21);
        const todayCount = series[targetDate] || 0;
        const delta = todayCount - baseline;
        
        // Anomaly detection rules - only flag increases
        const isHighAnomaly = (delta > baseline * 0.5) || (delta > 10);
        const isAnomaly = isHighAnomaly;
        
        const anomalyType = isHighAnomaly ? 'high' : 'normal';
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
    }

    return results;
}

// Populate date filter dropdown
function populateDateFilter(dates, maxDate) {
    const select = document.getElementById('date-filter');
    select.innerHTML = '';
    
    dates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDate(date);
        if (date === maxDate) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// Format date for display
function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Update date column header
function updateDateColumnHeader(date) {
    const today = new Date();
    const targetDate = new Date(date + 'T00:00:00');
    const headerEl = document.getElementById('date-column-header');
    
    // Check if dates match (ignoring time)
    const isToday = today.toDateString() === targetDate.toDateString();
    
    if (isToday) {
        headerEl.textContent = 'Today';
    } else {
        headerEl.textContent = formatDate(date);
    }
}

// Update table for selected date
function updateTableForDate(date) {
    currentDate = date;
    tableData = calculateMetricsForDate(allCategoryData, date);
    updateDateColumnHeader(date);
    renderDashboard();
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

// Get filtered data
function getFilteredData() {
    let filtered = getSortedData();
    
    // Apply status filter
    if (filters.status === 'anomaly') {
        filtered = filtered.filter(item => item.isAnomaly);
    } else if (filters.status === 'normal') {
        filtered = filtered.filter(item => !item.isAnomaly);
    }
    
    return filtered;
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
    const filteredData = getFilteredData();
    
    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #94a3b8;">No data matches the selected filters</td></tr>';
        return;
    }
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < filteredData.length; i++) {
        const item = filteredData[i];
        const row = document.createElement('tr');
        
        if (item.isAnomaly) {
            row.classList.add('anomaly-row');
        }
        
        // Build row HTML in one go
        row.innerHTML = `
            <td class="category-cell">${escapeHtml(item.category)}</td>
            <td class="today-cell text-right">${item.today_count}</td>
            <td class="baseline-cell text-right">${item.baseline}</td>
            <td class="delta-cell text-right ${item.delta > 0 ? 'delta-positive' : item.delta < 0 ? 'delta-negative' : 'delta-neutral'}">
                ${item.delta > 0 ? '+' : ''}${item.delta}
            </td>
        `;
        
        // Add badge as last cell
        const badgeCell = document.createElement('td');
        badgeCell.appendChild(createAnomalyBadge(item));
        row.appendChild(badgeCell);
        
        fragment.appendChild(row);
    }
    
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

// Escape HTML to prevent XSS
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
