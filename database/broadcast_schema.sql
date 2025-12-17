-- Broadcast Marketing Schema
-- Table to store broadcast campaigns for SMS and Email

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_name VARCHAR(255) NOT NULL,
    campaign_type ENUM('sms', 'email', 'both') NOT NULL,
    subject VARCHAR(500) DEFAULT NULL COMMENT 'Email subject line',
    message_text TEXT NOT NULL COMMENT 'Plain text message for SMS',
    message_html TEXT DEFAULT NULL COMMENT 'HTML content for email',
    target_audience ENUM('all_customers', 'all_patients', 'custom') NOT NULL DEFAULT 'all_patients',
    custom_recipients TEXT DEFAULT NULL COMMENT 'JSON array of custom recipient emails/phones',
    schedule_type ENUM('immediate', 'scheduled') NOT NULL DEFAULT 'immediate',
    scheduled_time DATETIME DEFAULT NULL COMMENT 'When to send if scheduled',
    status ENUM('draft', 'scheduled', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'draft',
    total_recipients INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME DEFAULT NULL,
    error_log TEXT DEFAULT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_status (status),
    INDEX idx_scheduled_time (scheduled_time),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to track individual broadcast sends
CREATE TABLE IF NOT EXISTS broadcast_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    recipient_type ENUM('email', 'phone') NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    sent_at DATETIME DEFAULT NULL,
    error_message TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
    INDEX idx_campaign_status (campaign_id, status),
    INDEX idx_recipient (recipient)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
