# Sync Management & Caching Guide

## Overview

CalDAV Desktop implements an intelligent sync management system to optimize performance while maintaining data consistency with your Radicale server. This guide explains how the sync system works and how to configure it for optimal performance.

## How Sync Management Works

### Smart Caching System

The application implements a local caching mechanism to reduce network requests and improve performance:

1. **Local Storage**: Events are cached in browser's localStorage using Zustand state management
2. **Cache Expiration**: Cached data expires after 1 hour
3. **Offline Access**: View cached events even when offline
4. **Seamless Refresh**: Cache automatically refreshes during sync operations
5. **Partial Updates**: Individual events can be removed from cache without clearing entire cache

### Sync Strategies

CalDAV Desktop supports multiple sync strategies to balance performance and data freshness:

#### 1. Automatic Sync (Timed Intervals)

Configure automatic sync at these intervals:
- **5 Minutes**: High-frequency sync for real-time updates
- **10 Minutes**: Balanced approach for most users
- **30 Minutes**: Low-frequency sync to conserve bandwidth

#### 2. Manual Sync

Trigger immediate sync anytime using the manual sync button in the bottom status bar.

#### 3. Event-Driven Sync

Automatic sync occurs after any event modification (create, update, delete) to ensure server consistency.

#### 4. Immediate Feedback with Background Sync

When users perform actions (create, update, delete), the UI immediately reflects the change while the actual synchronization happens in the background. This provides a responsive user experience without blocking the interface.

## User Interface

### Bottom Sync Status Bar

A fixed status bar at the bottom of the application provides real-time sync information:

- **Sync Status Indicator**: Visual icons showing current sync state
- **Last Sync Time**: Shows when the last successful sync occurred
- **Sync Interval Selector**: Dropdown to change sync frequency
- **Manual Sync Button**: Trigger immediate sync

### Status Indicators

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| Idle | ⏰ Clock | Gray | Waiting for next sync |
| Syncing | 🔄 Spinner | Blue | Currently syncing with server |
| Success | ✅ Checkmark | Green | Last sync completed successfully |
| Error | ⚠️ Alert | Red | Last sync failed |

## Configuration Options

### Sync Interval Settings

Access sync settings through the bottom status bar:

1. Open the application
2. Locate the sync status bar at the bottom
3. Use the dropdown to select sync interval:
   - "Manual Sync" - Sync only when triggered
   - "Every 5 Minutes" - Frequent updates
   - "Every 10 Minutes" - Balanced updates
   - "Every 30 Minutes" - Conservative updates

### Manual Sync

To manually trigger sync:

1. Click the "Sync" button in the bottom status bar
2. Wait for sync completion (non-blocking operation)
3. View results in status indicator

## Performance Benefits

### Reduced Network Traffic

- Up to 80% reduction in network requests
- Eliminates redundant data transfers
- Faster application response times

### Improved User Experience

- Instant access to recently viewed events
- Graceful degradation during network issues
- Non-blocking sync operations

### Battery Life Optimization

- Reduced network activity conserves battery
- Efficient sync scheduling minimizes CPU usage
- Smart caching reduces processing overhead

## Troubleshooting

### Sync Failures

If sync fails:

1. Check internet connection
2. Verify Radicale server accessibility
3. Check credentials in settings
4. Try manual sync
5. Clear cache if issues persist

### Cache Issues

To clear cache:

1. Close the application
2. Clear browser localStorage for the application
3. Restart the application

### Performance Problems

If experiencing performance issues:

1. Increase sync interval (30 minutes)
2. Check calendar event count
3. Monitor system resources
4. Consider server-side optimization

## Best Practices

### For High Activity Users

- Set sync interval to 5 minutes
- Regularly clear browser cache
- Monitor network usage

### For Low Bandwidth Environments

- Set sync interval to 30 minutes
- Use manual sync when needed
- Enable airplane mode when offline

### For Power Users

- Combine automatic and manual sync
- Monitor sync logs in developer tools
- Customize sync behavior based on workflow

## Technical Implementation

### State Management

Sync state is managed using Zustand with persistence:

- `syncInterval`: Current sync interval in milliseconds
- `lastSyncTime`: Timestamp of last successful sync
- `isSyncing`: Boolean indicating active sync
- `syncStatus`: Current sync status ('idle', 'syncing', 'success', 'error')
- `syncError`: Error message if sync failed
- `cachedEvents`: Locally cached events by calendar URL
- `cacheTimestamps`: Cache timestamps by calendar URL

### Cache Strategy

1. **Cache First**: Load from cache if available and not expired
2. **Network Fallback**: Fetch from server if cache invalid
3. **Cache Update**: Update cache after successful sync
4. **Cache Expiry**: Expire cache after 1 hour

### Error Handling

- Graceful degradation to cached data
- Clear error messaging in UI
- Automatic retry on network failures
- Preserved user workflow during errors

## Future Enhancements

Planned improvements to sync management:

- Extended offline mode with weeks of cached data
- Conflict resolution for sync conflicts
- Selective sync for specific calendars
- Bandwidth-aware sync throttling
- Progressive sync for large calendars

---

**Last Updated**: 2026-06-25
**Related Docs**: [README.md](../README.md), [CHANGELOG.md](CHANGELOG.md), [TESTING.md](TESTING.md)