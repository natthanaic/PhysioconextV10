# Broadcast Marketing Feature Setup Guide

## Overview
The Broadcast Marketing feature allows ADMIN and PT users to send mass SMS and email campaigns to customers/patients. This feature includes:
- Rich text editor for email campaigns with HTML/embed support
- Plain text editor for SMS campaigns with link support
- Scheduling capabilities for campaigns
- Campaign tracking and statistics
- Event/blog creation for scheduled sends

## Database Setup

### 1. Run the Database Schema
Execute the SQL script to create the necessary tables:

```bash
mysql -u your_username -p your_database < database/broadcast_schema.sql
```

Or manually run the SQL in your MySQL client:

```sql
-- Run the contents of database/broadcast_schema.sql
```

This creates two tables:
- `broadcast_campaigns` - Stores campaign details
- `broadcast_logs` - Tracks individual message sends

## Configuration

### 1. SMTP Settings (for Email Campaigns)
Navigate to: **Admin Settings → Notification Settings → Email (SMTP)**

Configure:
- SMTP Host (e.g., smtp.gmail.com)
- SMTP Port (587 for TLS, 465 for SSL)
- SMTP Username
- SMTP Password
- From Name
- From Email

### 2. SMS Settings (for SMS Campaigns)
Navigate to: **Admin Settings → Notification Settings → SMS Notification**

Configure:
- Thai Bulk SMS API Key
- Thai Bulk SMS API Secret
- Sender Name
- Default Recipients

**Note:** Ensure you have credits in your Thai Bulk SMS account.

## Using the Broadcast Feature

### Accessing the Feature
1. Login as ADMIN or PT user
2. Click **Broadcast Marketing** in the sidebar menu

### Creating a Campaign

#### Step 1: Click "Create New Campaign"

#### Step 2: Fill in Campaign Details
- **Campaign Name**: Give your campaign a descriptive name
- **Campaign Type**: Choose from:
  - SMS Only
  - Email Only
  - Both SMS & Email
- **Target Audience**: Currently supports "All Patients"
- **Schedule**:
  - Send Immediately
  - Schedule for Later (select date/time)

#### Step 3: Compose Your Message

**For SMS:**
- Enter plain text message
- Character count is displayed
- You can include links in the text
- Example: "Visit our website: https://example.com"

**For Email:**
- Enter subject line
- Enter plain text message (used as fallback)
- Use the rich text editor to format your email:
  - Bold, italic, underline text
  - Add headers and lists
  - Insert images (via URL)
  - Embed videos (via URL)
  - Add links
  - Change colors and fonts
  - Add code blocks

#### Step 4: Save or Send
- Click **Save Campaign** to save as draft
- Click the **Send** button from the campaigns list to broadcast immediately
- Scheduled campaigns will be sent automatically at the specified time

### Campaign Management

#### View Campaign
- Click the **eye icon** to view campaign details
- See message content, recipients, and delivery status

#### Edit Campaign
- Only draft and scheduled campaigns can be edited
- Click the **pencil icon** to edit
- Modify any field and save

#### Send Campaign
- Click the **send icon** on draft campaigns
- Confirm the send action
- Campaign will be processed and sent to all recipients

#### Delete Campaign
- Click the **trash icon** to delete
- Cannot delete campaigns that are currently sending

### Campaign Statistics

The dashboard shows:
- **Total Campaigns**: Number of campaigns created
- **Sent Campaigns**: Successfully sent campaigns
- **Scheduled Campaigns**: Campaigns waiting to be sent
- **Total Recipients**: Total messages sent across all campaigns

### Delivery Tracking

Each campaign shows:
- Total recipients
- Successfully sent count (green)
- Failed count (red)
- Current status:
  - **Draft**: Not sent yet
  - **Scheduled**: Waiting for scheduled time
  - **Sending**: Currently being sent
  - **Sent**: Completed
  - **Failed**: Send failed

## Best Practices

### Email Campaigns
1. Always include a plain text version (message_text field)
2. Test with a small group before sending to all
3. Use responsive HTML that works on mobile
4. Include unsubscribe link for compliance
5. Keep subject lines under 50 characters

### SMS Campaigns
1. Keep messages concise (160 characters for single SMS)
2. Include clear call-to-action
3. Use URL shorteners for links
4. Add sender identification
5. Respect timing (don't send late at night)

### Scheduling
1. Schedule campaigns during business hours
2. Avoid weekends unless necessary
3. Consider timezone differences
4. Test scheduled campaigns first

## Troubleshooting

### Email Not Sending
1. Check SMTP settings in Notification Settings
2. Verify SMTP credentials are correct
3. Check if SMTP is enabled
4. Test SMTP connection using the test button
5. Check error logs in broadcast_logs table

### SMS Not Sending
1. Check SMS settings in Notification Settings
2. Verify API credentials
3. Ensure sufficient credits in Thai Bulk SMS account
4. Check if SMS is enabled
5. Verify phone number format

### Recipients Not Found
1. Ensure patients have email/phone in database
2. Check if patients are marked as active
3. Verify target audience selection

## API Endpoints

### Get All Campaigns
```
GET /api/broadcast/campaigns
```

### Get Single Campaign
```
GET /api/broadcast/campaigns/:id
```

### Create Campaign
```
POST /api/broadcast/campaigns
Body: {
  campaign_name, campaign_type, subject,
  message_text, message_html, target_audience,
  schedule_type, scheduled_time
}
```

### Update Campaign
```
PUT /api/broadcast/campaigns/:id
Body: { ...campaign fields... }
```

### Send Campaign
```
POST /api/broadcast/campaigns/:id/send
```

### Delete Campaign
```
DELETE /api/broadcast/campaigns/:id
```

### Get Statistics
```
GET /api/broadcast/stats
```

## Security Notes

1. Only ADMIN and PT roles can access broadcast features
2. All actions are logged in audit_logs table
3. Campaigns cannot be modified after sending
4. HTML content is not sanitized - ensure trusted input only

## Future Enhancements

Potential additions:
- Custom recipient lists (CSV upload)
- Campaign templates
- A/B testing
- Delivery analytics
- Customer segmentation
- Automated campaigns based on events
- Click tracking for links
- Unsubscribe management

## Support

For issues or questions:
1. Check error logs: broadcast_logs table
2. Review audit logs for actions
3. Verify notification settings are configured
4. Contact system administrator
