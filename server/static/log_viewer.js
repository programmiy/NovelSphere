document.addEventListener('DOMContentLoaded', () => {
    const logContent = document.getElementById('logContent');
    const refreshButton = document.getElementById('refreshLogs');

    async function fetchLogs() {
        try {
            const response = await fetch('/api/logs');
            const data = await response.json();

            if (data.message === "Success") {
                logContent.textContent = data.logs.join(''); // Join array of lines into a single string
                logContent.scrollTop = logContent.scrollHeight; // Scroll to bottom
            } else {
                logContent.textContent = `Error: ${data.message}`;
            }
        } catch (error) {
            logContent.textContent = `Failed to fetch logs: ${error}`;
            console.error('Error fetching logs:', error);
        }
    }

    // Fetch logs on initial load
    fetchLogs();

    // Refresh logs on button click
    refreshButton.addEventListener('click', fetchLogs);

    // Optional: Auto-refresh every 5 seconds
    // setInterval(fetchLogs, 5000);
});