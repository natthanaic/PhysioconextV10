<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Notification Settings - RehabPlus System</title>
    <link rel="icon" href="/public/images/Fav.png" type="image/x-icon">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        body {
            background: #f5f7fb;
            min-height: 100vh;
        }

        .sidebar {
            min-height: 100vh;
            background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
            box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08);
        }

        .sidebar .nav-link {
            color: rgba(255, 255, 255, 0.85);
            padding: 0.75rem 1rem;
            margin: 0.25rem 1rem;
            border-radius: 0.5rem;
            transition: all 0.3s ease;
            font-weight: 500;
        }

        .sidebar .nav-link:hover,
        .sidebar .nav-link.active {
            background: rgba(255, 255, 255, 0.25);
            color: #fff;
        }

        main {
            min-height: 100vh;
            padding-bottom: 4rem;
        }

        .page-header {
            background: white;
            border-radius: 1.5rem;
            padding: 2rem;
            box-shadow: 0 10px 40px rgba(82, 95, 225, 0.12);
            margin-bottom: 2rem;
        }

        .page-header h1 {
            font-weight: 700;
            color: #2d2f44;
        }

        .page-header p {
            color: #6c6f93;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            font-weight: 600;
            padding: 0.6rem 1.6rem;
            border-radius: 0.75rem;
            transition: all 0.3s ease;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.35);
        }

        .btn-success {
            background: linear-gradient(135deg, #48c774 0%, #3aa863 100%);
            border: none;
            font-weight: 600;
            padding: 0.6rem 1.6rem;
            border-radius: 0.75rem;
            transition: all 0.3s ease;
        }

        .btn-success:hover {
            background: linear-gradient(135deg, #3bb562 0%, #2e9251 100%);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(72, 199, 116, 0.35);
        }

        .nav-tabs {
            border-bottom: 2px solid rgba(102, 126, 234, 0.15);
            margin-bottom: 2rem;
        }

        .nav-tabs .nav-link {
            border: none;
            color: #6c6f93;
            font-weight: 600;
            padding: 1rem 1.5rem;
            border-radius: 0.75rem 0.75rem 0 0;
            transition: all 0.3s ease;
        }

        .nav-tabs .nav-link:hover {
            background: rgba(102, 126, 234, 0.08);
            color: #667eea;
        }

        .nav-tabs .nav-link.active {
            background: white;
            color: #667eea;
            border-bottom: 3px solid #667eea;
        }

        .settings-card {
            border: none;
            border-radius: 1.25rem;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
            margin-bottom: 1.5rem;
            background: white;
        }

        .settings-card .card-header {
            background: transparent;
            border-bottom: 1px solid rgba(102, 126, 234, 0.15);
            padding: 1.5rem;
            border-radius: 1.25rem 1.25rem 0 0;
        }

        .settings-card .card-header h4 {
            margin: 0;
            font-weight: 700;
            color: #2d2f44;
            font-size: 1.25rem;
        }

        .settings-card .card-body {
            padding: 2rem;
        }

        .form-label {
            font-weight: 600;
            color: #2d2f44;
            margin-bottom: 0.5rem;
            font-size: 0.95rem;
        }

        .form-control,
        .form-select {
            border: 1px solid rgba(102, 126, 234, 0.2);
            border-radius: 0.75rem;
            padding: 0.65rem 1rem;
            transition: all 0.3s ease;
        }

        .form-control:focus,
        .form-select:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.15);
        }

        .form-text {
            font-size: 0.875rem;
            color: #6c6f93;
            margin-top: 0.25rem;
        }

        .notification-status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.85rem;
            border-radius: 999px;
            font-size: 0.85rem;
            font-weight: 600;
        }

        .notification-status.active {
            background: rgba(25, 135, 84, 0.15);
            color: #198754;
        }

        .notification-status.inactive {
            background: rgba(108, 117, 125, 0.15);
            color: #6c757d;
        }

        .notification-status::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }

        .alert {
            border: none;
            border-radius: 1rem;
            padding: 1rem 1.25rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .form-check {
            padding: 0.75rem;
            border-radius: 0.75rem;
            transition: all 0.2s ease;
            margin-bottom: 0.5rem;
        }

        .form-check:hover {
            background: rgba(102, 126, 234, 0.05);
        }

        .form-check-input {
            width: 1.25rem;
            height: 1.25rem;
            border: 2px solid rgba(102, 126, 234, 0.3);
            border-radius: 0.375rem;
            cursor: pointer;
        }

        .form-check-input:checked {
            background-color: #667eea;
            border-color: #667eea;
        }

        .form-check-label {
            font-weight: 500;
            color: #2d2f44;
            cursor: pointer;
            margin-left: 0.5rem;
        }

        .info-card {
            background: rgba(102, 126, 234, 0.08);
            border: 1px solid rgba(102, 126, 234, 0.2);
            border-radius: 1rem;
            padding: 1.5rem;
        }

        .info-card h4 {
            color: #667eea;
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 1rem;
        }

        .info-card ol {
            color: #2d2f44;
            padding-left: 1.25rem;
        }

        .info-card ol li {
            margin-bottom: 0.5rem;
        }

        .info-card a {
            color: #667eea;
            font-weight: 600;
            text-decoration: none;
        }

        .info-card a:hover {
            text-decoration: underline;
        }

        .input-group .btn {
            border-radius: 0 0.75rem 0.75rem 0;
        }

        .input-group .form-control {
            border-radius: 0.75rem 0 0 0.75rem;
        }
    </style>
</head>
<body>
    <!-- Mobile navbar toggle -->
    <nav class="navbar navbar-dark bg-dark d-md-none">
        <div class="container-fluid">
            <span class="navbar-brand">RehabPlus System</span>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebarMenu" aria-controls="sidebarMenu" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
        </div>
    </nav>

    <div class="container-fluid">
        <div class="row">
            <%- include('partials/sidebar', { user, activePage: 'notification-settings' }) %>

            <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4 py-4">
                <div class="page-header">
                    <h1 class="h3 mb-2">
                        <i class="bi bi-bell-fill me-2 text-primary"></i>Notification Settings
                    </h1>
                    <p class="mb-0">Configure email (SMTP) and LINE notification system for automated alerts.</p>
                </div>

                <!-- Alert Container -->
                <div id="alertContainer"></div>

                <!-- Tabs Navigation -->
                <ul class="nav nav-tabs" id="notificationTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="smtp-tab" data-bs-toggle="tab" data-bs-target="#smtp" type="button" role="tab">
                            <i class="bi bi-envelope-fill me-2"></i>Email (SMTP)
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="line-tab" data-bs-toggle="tab" data-bs-target="#line" type="button" role="tab">
                            <i class="bi bi-chat-dots-fill me-2"></i>LINE Notification
                        </button>
                    </li>
                </ul>

                <!-- Tab Content -->
                <div class="tab-content" id="notificationTabContent">

                    <!-- SMTP Settings Tab -->
                    <div class="tab-pane fade show active" id="smtp" role="tabpanel">
                        <div class="settings-card card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <div>
                                    <h4><i class="bi bi-envelope-at me-2"></i>SMTP Mail Server Configuration</h4>
                                </div>
                                <div>
                                    <span id="smtpStatus" class="notification-status inactive">Inactive</span>
                                </div>
                            </div>

                            <div class="card-body">
                                <form id="smtpForm">
                                    <div class="row">
                                        <div class="col-md-6 mb-3">
                                            <label for="smtpEnabled" class="form-label">Enable SMTP</label>
                                            <select class="form-select" id="smtpEnabled">
                                                <option value="0">Disabled</option>
                                                <option value="1">Enabled</option>
                                            </select>
                                            <div class="form-text">Enable or disable email notifications</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpHost" class="form-label">SMTP Host <span class="text-danger">*</span></label>
                                            <input type="text" class="form-control" id="smtpHost" placeholder="smtp.gmail.com">
                                            <div class="form-text">SMTP server hostname</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpPort" class="form-label">SMTP Port <span class="text-danger">*</span></label>
                                            <input type="number" class="form-control" id="smtpPort" placeholder="587">
                                            <div class="form-text">Common ports: 587 (TLS), 465 (SSL), 25 (Standard)</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpSecure" class="form-label">Encryption</label>
                                            <select class="form-select" id="smtpSecure">
                                                <option value="none">None</option>
                                                <option value="tls">TLS</option>
                                                <option value="ssl">SSL</option>
                                            </select>
                                            <div class="form-text">Encryption method for secure connection</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpUser" class="form-label">SMTP Username <span class="text-danger">*</span></label>
                                            <input type="text" class="form-control" id="smtpUser" placeholder="your-email@example.com">
                                            <div class="form-text">Email address or username for authentication</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpPassword" class="form-label">SMTP Password <span class="text-danger">*</span></label>
                                            <input type="password" class="form-control" id="smtpPassword" placeholder="••••••••">
                                            <div class="form-text">Password or app-specific password</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpFromName" class="form-label">From Name</label>
                                            <input type="text" class="form-control" id="smtpFromName" placeholder="RehabPlus Notification">
                                            <div class="form-text">Display name for sender</div>
                                        </div>

                                        <div class="col-md-6 mb-3">
                                            <label for="smtpFromEmail" class="form-label">From Email <span class="text-danger">*</span></label>
                                            <input type="email" class="form-control" id="smtpFromEmail" placeholder="noreply@rehabplus.com">
                                            <div class="form-text">Email address shown as sender</div>
                                        </div>

                                        <div class="col-md-12 mb-3">
                                            <label for="smtpTestEmail" class="form-label">Test Email Address</label>
                                            <div class="input-group">
                                                <input type="email" class="form-control" id="smtpTestEmail" placeholder="test@example.com">
                                                <button class="btn btn-success" type="button" onclick="testSMTP()">
                                                    <i class="bi bi-send me-2"></i>Send Test Email
                                                </button>
                                            </div>
                                            <div class="form-text">Send a test email to verify SMTP configuration</div>
                                        </div>
                                    </div>

                                    <div class="mt-4">
                                        <button type="submit" class="btn btn-primary">
                                            <i class="bi bi-check-circle me-2"></i>Save SMTP Settings
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>

                    <!-- LINE Notification Tab -->
                    <div class="tab-pane fade" id="line" role="tabpanel">
                        <div class="settings-card card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <div>
                                    <h4><i class="bi bi-chat-square-dots me-2"></i>LINE Messaging API Configuration</h4>
                                </div>
                                <div>
                                    <span id="lineStatus" class="notification-status inactive">Inactive</span>
                                </div>
                            </div>

                            <div class="card-body">
                                <form id="lineForm">
                                    <div class="row">
                                        <div class="col-md-12 mb-3">
                                            <label for="lineEnabled" class="form-label">Enable LINE Notification</label>
                                            <select class="form-select" id="lineEnabled">
                                                <option value="0">Disabled</option>
                                                <option value="1">Enabled</option>
                                            </select>
                                            <div class="form-text">Enable or disable LINE notifications</div>
                                        </div>

                                        <div class="col-md-12 mb-3">
                                            <label for="lineAccessToken" class="form-label">Channel Access Token <span class="text-danger">*</span></label>
                                            <input type="password" class="form-control" id="lineAccessToken" placeholder="Enter Channel Access Token (long-lived)">
											<div class="form-text">
                                              Get from <a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a> → Your Channel → Messaging API → Channel access token
                                            </div>
                                        </div>

                                        <div class="col-md-12 mb-3">
                                            <label for="lineTargetId" class="form-label">Target User ID or Group ID <span class="text-danger">*</span></label>
                                            <input type="text" class="form-control" id="lineTargetId" placeholder="User ID (U...) or Group ID (C...)">
                                            <div class="form-text">
                                                User ID starts with "U", Group ID starts with "C" or "R". Get this from webhook events or LINE Official Account Manager.
                                            </div>
                                        </div>

                                        <div class="col-md-12 mb-3">
                                            <label class="form-label">Notification Events</label>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="lineNewAppointment">
                                                <label class="form-check-label" for="lineNewAppointment">
                                                    New Appointment Created
                                                </label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="lineAppointmentCancelled">
                                                <label class="form-check-label" for="lineAppointmentCancelled">
                                                    Appointment Cancelled
                                                </label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="lineNewPatient">
                                                <label class="form-check-label" for="lineNewPatient">
                                                    New Patient Registered
                                                </label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="linePaymentReceived">
                                                <label class="form-check-label" for="linePaymentReceived">
                                                    Payment Received
                                                </label>
                                            </div>
                                            <div class="form-text mt-2">Select which events trigger LINE notifications</div>
                                        </div>

                                        <div class="col-md-12 mb-3">
                                            <label for="lineTestMessage" class="form-label">Test Message</label>
                                            <div class="input-group">
                                                <input type="text" class="form-control" id="lineTestMessage" placeholder="Test notification message" value="Test from RehabPlus">
                                                <button class="btn btn-success" type="button" onclick="testLINE()">
                                                    <i class="bi bi-send me-2"></i>Send Test Message
                                                </button>
                                            </div>
                                          <div class="form-text">Send a test message to verify LINE Messaging API configuration</div>
                                        </div>
                                    </div>

                                    <div class="mt-4">
                                        <button type="submit" class="btn btn-primary">
                                            <i class="bi bi-check-circle me-2"></i>Save LINE Settings
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <!-- LINE Setup Instructions -->
                        <div class="info-card">
                            <h4><i class="bi bi-info-circle me-2"></i>How to Setup Messaging API</h4>
                            <ol>
                                <li>Visit <a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a></li>
                                <li>Login with your LINE account</li>
                                <li>Create a Provider (if you don't have one)</li>
                                <li>Create a new Messaging API channel</li>
                                <li>Go to your channel → "Messaging API" tab</li>
                                <li>Issue a Channel Access Token (long-lived)</li>
                                <li>Copy the Channel Access Token</li>
                                <li>To get User/Group ID:
                                    <ul>
                                        <li>Add your bot as a friend</li>
                                        <li>Send a message to the bot</li>
                                        <li>Check webhook events for the User ID or Group ID</li>
                                        <li>Or use the <a href="https://developers.line.biz/en/docs/messaging-api/getting-user-ids/" target="_blank">LINE Official Account Manager</a></li>
                                    </ul>
                                </li>
                                <li>Paste the tokens in the fields above and save</li>
                            </ol>
                        </div>
                    </div>

                </div>
            </main>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // Inline utility functions to avoid external JS file loading issues
        function getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }

        function showAlert(message, type = 'info', duration = 5000) {
            const alertHtml = `
                <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3" style="z-index: 9999; max-width: 500px;">
                    ${message}
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', alertHtml);
            setTimeout(() => {
                const alert = document.querySelector('.alert');
                if (alert) alert.remove();
            }, duration);
        }

        function validateEmail(email) {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(String(email).toLowerCase());
        }

        async function apiGet(endpoint) {
            const response = await fetch(endpoint, {
                headers: {}
            });
            if (!response.ok) throw new Error(await response.text());
            return await response.json();
        }

        async function apiPost(endpoint, data) {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(await response.text());
            return await response.json();
        }
    </script>
    <script>
        // Notification Settings Management - Inline to avoid proxy blocking
        document.addEventListener('DOMContentLoaded', function() {
            loadSMTPSettings();
            loadLINESettings();
            setupFormHandlers();
        });

        function setupFormHandlers() {
            document.getElementById('smtpForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                await saveSMTPSettings();
            });
            document.getElementById('lineForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                await saveLINESettings();
            });
            document.getElementById('smtpEnabled').addEventListener('change', function() {
                updateStatusBadge('smtp', this.value === '1');
            });
            document.getElementById('lineEnabled').addEventListener('change', function() {
                updateStatusBadge('line', this.value === '1');
            });
        }

        function updateStatusBadge(type, enabled) {
            const badge = document.getElementById(`${type}Status`);
            if (enabled) {
                badge.className = 'notification-status active';
                badge.textContent = 'Active';
            } else {
                badge.className = 'notification-status inactive';
                badge.textContent = 'Inactive';
            }
        }

        async function loadSMTPSettings() {
            try {
                const settings = await apiGet('/api/admin/notification/smtp');
                populateSMTPForm(settings);
            } catch (error) {
                if (error.message && (error.message.includes('404') || error.message.includes('Not Found'))) {
                    console.log('No SMTP settings found, using defaults');
                } else {
                    console.error('Error loading SMTP settings:', error);
                    showAlert('Failed to load SMTP settings: ' + error.message, 'danger');
                }
            }
        }

        function populateSMTPForm(settings) {
            if (!settings) return;
            document.getElementById('smtpEnabled').value = settings.enabled || '0';
            document.getElementById('smtpHost').value = settings.host || '';
            document.getElementById('smtpPort').value = settings.port || '';
            document.getElementById('smtpSecure').value = settings.secure || 'none';
            document.getElementById('smtpUser').value = settings.user || '';
            document.getElementById('smtpPassword').value = settings.password || '';
            document.getElementById('smtpFromName').value = settings.fromName || '';
            document.getElementById('smtpFromEmail').value = settings.fromEmail || '';
            updateStatusBadge('smtp', settings.enabled === 1 || settings.enabled === '1');
        }

        async function saveSMTPSettings() {
            try {
                const settings = {
                    enabled: parseInt(document.getElementById('smtpEnabled').value),
                    host: document.getElementById('smtpHost').value.trim(),
                    port: document.getElementById('smtpPort').value,
                    secure: document.getElementById('smtpSecure').value,
                    user: document.getElementById('smtpUser').value.trim(),
                    password: document.getElementById('smtpPassword').value,
                    fromName: document.getElementById('smtpFromName').value.trim(),
                    fromEmail: document.getElementById('smtpFromEmail').value.trim()
                };
                if (settings.enabled === 1) {
                    if (!settings.host || !settings.port || !settings.user || !settings.password || !settings.fromEmail) {
                        showAlert('Please fill in all required fields', 'warning');
                        return;
                    }
                    if (!validateEmail(settings.fromEmail)) {
                        showAlert('Please enter a valid email address', 'warning');
                        return;
                    }
                }
                await apiPost('/api/admin/notification/smtp', settings);
                showAlert('SMTP settings saved successfully', 'success');
                updateStatusBadge('smtp', settings.enabled === 1);
            } catch (error) {
                console.error('Error saving SMTP settings:', error);
                showAlert(error.message || 'Failed to save SMTP settings', 'danger');
            }
        }

        async function testSMTP() {
            const testEmail = document.getElementById('smtpTestEmail').value.trim();
            if (!testEmail) {
                showAlert('Please enter a test email address', 'warning');
                return;
            }
            if (!validateEmail(testEmail)) {
                showAlert('Please enter a valid email address', 'warning');
                return;
            }
            try {
                showAlert('Sending test email...', 'info');
                await apiPost('/api/admin/notification/smtp/test', { email: testEmail });
                showAlert('Test email sent successfully! Please check your inbox.', 'success');
            } catch (error) {
                console.error('Error testing SMTP:', error);
                showAlert(error.message || 'Failed to send test email. Please check your settings.', 'danger');
            }
        }

        async function loadLINESettings() {
            try {
                const settings = await apiGet('/api/admin/notification/line');
                populateLINEForm(settings);
            } catch (error) {
                if (error.message && (error.message.includes('404') || error.message.includes('Not Found'))) {
                    console.log('No LINE settings found, using defaults');
                } else {
                    console.error('Error loading LINE settings:', error);
                    showAlert('Failed to load LINE settings: ' + error.message, 'danger');
                }
            }
        }

        function populateLINEForm(settings) {
            if (!settings) return;
            document.getElementById('lineEnabled').value = settings.enabled || '0';
            document.getElementById('lineAccessToken').value = settings.accessToken || '';
            document.getElementById('lineTargetId').value = settings.targetId || '';
            if (settings.eventNotifications) {
                let events;
                if (typeof settings.eventNotifications === 'string') {
                    try { events = JSON.parse(settings.eventNotifications); }
                    catch (e) { events = {}; }
                } else {
                    events = settings.eventNotifications;
                }
                document.getElementById('lineNewAppointment').checked = events.newAppointment || false;
                document.getElementById('lineAppointmentCancelled').checked = events.appointmentCancelled || false;
                document.getElementById('lineNewPatient').checked = events.newPatient || false;
                document.getElementById('linePaymentReceived').checked = events.paymentReceived || false;
            }
            updateStatusBadge('line', settings.enabled === 1 || settings.enabled === '1');
        }

        async function saveLINESettings() {
            try {
                const eventNotifications = {
                    newAppointment: document.getElementById('lineNewAppointment').checked,
                    appointmentCancelled: document.getElementById('lineAppointmentCancelled').checked,
                    newPatient: document.getElementById('lineNewPatient').checked,
                    paymentReceived: document.getElementById('linePaymentReceived').checked
                };
                const settings = {
                    enabled: parseInt(document.getElementById('lineEnabled').value),
                    targetId: document.getElementById('lineTargetId').value.trim(),
                    accessToken: document.getElementById('lineAccessToken').value.trim(),
                    eventNotifications: JSON.stringify(eventNotifications)
                };
                if (settings.enabled === 1) {
                    if (!settings.accessToken) {
                        showAlert('Please enter Channel Access Token', 'warning');
                        return;
                    }
                    if (!settings.targetId) {
                        showAlert('Please enter Target User ID or Group ID', 'warning');
                        return;
                    }
                }
                await apiPost('/api/admin/notification/line', settings);
                showAlert('LINE settings saved successfully', 'success');
                updateStatusBadge('line', settings.enabled === 1);
            } catch (error) {
                console.error('Error saving LINE settings:', error);
                showAlert(error.message || 'Failed to save LINE settings', 'danger');
            }
        }

        async function testLINE() {
            const testMessage = document.getElementById('lineTestMessage').value.trim();
            if (!testMessage) {
                showAlert('Please enter a test message', 'warning');
                return;
            }
            try {
                showAlert('Sending test notification...', 'info');
                await apiPost('/api/admin/notification/line/test', { message: testMessage });
                showAlert('Test notification sent successfully! Please check your LINE app.', 'success');
            } catch (error) {
                console.error('Error testing LINE:', error);
                showAlert(error.message || 'Failed to send test notification. Please check your settings.', 'danger');
            }
        }
    </script>
</body>
</html>