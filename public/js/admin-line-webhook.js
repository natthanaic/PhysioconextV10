<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LINE Webhook IDs - RehabPlus System</title>
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

        .card {
            border: none;
            border-radius: 1.25rem;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
            margin-bottom: 1.5rem;
            background: white;
        }

        .card-header {
            background: transparent;
            border-bottom: 1px solid rgba(102, 126, 234, 0.15);
            padding: 1.5rem;
            border-radius: 1.25rem 1.25rem 0 0;
        }

        .card-header h4 {
            margin: 0;
            font-weight: 700;
            color: #2d2f44;
            font-size: 1.25rem;
        }

        .card-body {
            padding: 2rem;
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

        .event-card {
            background: rgba(102, 126, 234, 0.05);
            border: 1px solid rgba(102, 126, 234, 0.2);
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 1rem;
        }

        .id-display {
            background: white;
            border: 2px solid #667eea;
            border-radius: 0.75rem;
            padding: 1rem;
            font-family: monospace;
            font-size: 1.1rem;
            color: #667eea;
            font-weight: 600;
            margin: 0.5rem 0;
            word-break: break-all;
        }

        .copy-btn {
            background: #48c774;
            color: white;
            border: none;
            border-radius: 0.5rem;
            padding: 0.5rem 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .copy-btn:hover {
            background: #3aa863;
            transform: translateY(-2px);
        }

        .no-events {
            text-align: center;
            padding: 3rem;
            color: #6c6f93;
        }

        .no-events i {
            font-size: 4rem;
            color: #667eea;
            margin-bottom: 1rem;
        }

        .timestamp {
            color: #6c6f93;
            font-size: 0.9rem;
            font-style: italic;
        }

        .badge {
            padding: 0.5rem 1rem;
            border-radius: 999px;
            font-weight: 600;
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
                        <i class="bi bi-chat-dots-fill me-2 text-primary"></i>LINE Webhook - User/Group IDs
                    </h1>
                    <p class="mb-0">Capture User IDs or Group IDs from LINE bot messages</p>
                </div>

                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h4><i class="bi bi-list-check me-2"></i>Recent Webhook Events</h4>
                        <button class="btn btn-primary" onclick="loadEvents()">
                            <i class="bi bi-arrow-clockwise me-2"></i>Refresh
                        </button>
                    </div>
                    <div class="card-body">
                        <div class="alert alert-info">
                            <h5><i class="bi bi-info-circle me-2"></i>Instructions:</h5>
                            <ol class="mb-0">
                                <li>Add your LINE Official Account as a friend (or add bot to a group)</li>
                                <li>Send ANY message to your bot (e.g., "Hello")</li>
                                <li>Click the <strong>"Refresh"</strong> button above</li>
                                <li>Copy the User ID or Group ID shown below</li>
                                <li>Paste it in <a href="/admin/notification-settings">Notification Settings</a></li>
                            </ol>
                        </div>

                        <div id="eventsContainer">
                            <div class="no-events">
                                <i class="bi bi-inbox"></i>
                                <p><strong>No events captured yet</strong></p>
                                <p>Send a message to your LINE bot to see User/Group IDs here</p>
                                <button class="btn btn-primary mt-3" onclick="loadEvents()">
                                    <i class="bi bi-arrow-clockwise me-2"></i>Check for Events
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4><i class="bi bi-question-circle me-2"></i>Need Help?</h4>
                    </div>
                    <div class="card-body">
                        <p><strong>Where to find your LINE bot QR code:</strong></p>
                        <ol>
                            <li>Go to <a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a></li>
                            <li>Select your Provider and Channel</li>
                            <li>Go to "Messaging API" tab</li>
                            <li>Find the QR code in "Bot information" section</li>
                            <li>Scan with LINE app and add as friend</li>
                        </ol>

                        <p class="mt-3"><strong>Webhook Status:</strong></p>
                        <p>Webhook URL: <code>https://rehabplus.lantavafix.com/webhook/line</code></p>
                        <p>Make sure "Use webhook" is enabled in LINE Developers Console</p>
                    </div>
                </div>
            </main>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="/public/js/utils.js"></script>
    <script src="/public/js/admin-line-webhook.js"></script>
</body>
</html>