#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

static void (*eventCallback)(void);

static BOOL ownedIdentifier(NSString *identifier) {
    if ([identifier hasPrefix:@"cadence-spike."]) return YES;
    if (![identifier hasPrefix:@"cadence.local."]) return NO;
    NSString *suffix = [identifier substringFromIndex:@"cadence.local.".length];
    return suffix.length == 36 && [[NSUUID alloc] initWithUUIDString:suffix] != nil;
}

static NSString *timestamp(NSDate *date) {
    NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
    return [formatter stringFromDate:date];
}

static char *encode(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data) return strdup("{\"error\":\"Native JSON encoding failed.\"}");
    return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

static NSDate *requestFireDate(UNNotificationRequest *request) {
    if (![request.trigger isKindOfClass:UNCalendarNotificationTrigger.class]) return nil;
    UNCalendarNotificationTrigger *trigger = (UNCalendarNotificationTrigger *)request.trigger;
    if (trigger.repeats) return nil;
    NSDateComponents *components = trigger.dateComponents;
    // nextTriggerDate is nil once a one-shot notification fires. Its captured calendar components remain exact.
    return components.calendar ? [components.calendar dateFromComponents:components] : nil;
}

@interface CadenceNative : NSObject <UNUserNotificationCenterDelegate>
@property NSMutableArray<NSDictionary *> *events;
@property NSMutableArray *observers;
@end

static CadenceNative *adapter;

@implementation CadenceNative
- (instancetype)init {
    if ((self = [super init])) {
        self.events = [NSMutableArray new];
        self.observers = [NSMutableArray new];
    }
    return self;
}

- (void)record:(NSString *)kind identifier:(NSString *)identifier {
    NSMutableDictionary *event = [@{ @"kind": kind, @"at": timestamp([NSDate date]) } mutableCopy];
    if (identifier) event[@"id"] = identifier;
    @synchronized(self) { [self.events addObject:event]; }
    if (eventCallback) eventCallback();
}

- (void)record:(NSString *)kind notification:(UNNotification *)notification {
    UNNotificationRequest *request = notification.request;
    NSMutableDictionary *event = [@{ @"kind": kind, @"id": request.identifier, @"at": timestamp([NSDate date]) } mutableCopy];
    NSDate *fireAt = requestFireDate(request);
    if (ownedIdentifier(request.identifier) && fireAt) {
        event[@"delivery"] = @{ @"requestId": request.identifier, @"fireAt": timestamp(fireAt),
            @"title": request.content.title, @"body": request.content.body, @"deliveredAt": timestamp(notification.date) };
    }
    @synchronized(self) { [self.events addObject:event]; }
    if (eventCallback) eventCallback();
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    [self record:@"notificationPresented" notification:notification];
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
        withCompletionHandler:(void (^)(void))completionHandler {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        [self record:@"notificationActivated" notification:response.notification];
    }
    completionHandler();
}
@end

void cadence_native_initialize(void (*callback)(void)) {
    @autoreleasepool {
        eventCallback = callback;
        adapter = [CadenceNative new];
        // UserNotifications requires an application bundle. Raw `cargo run` remains useful for SQLite.
        if (NSBundle.mainBundle.bundleIdentifier.length) {
            UNUserNotificationCenter.currentNotificationCenter.delegate = adapter;
        }
        id wake = [NSWorkspace.sharedWorkspace.notificationCenter
            addObserverForName:NSWorkspaceDidWakeNotification object:nil queue:nil
            usingBlock:^(NSNotification *note) { (void)note; [adapter record:@"wake" identifier:nil]; }];
        id active = [NSNotificationCenter.defaultCenter
            addObserverForName:NSApplicationDidBecomeActiveNotification object:nil queue:nil
            usingBlock:^(NSNotification *note) { (void)note; [adapter record:@"resume" identifier:nil]; }];
        [adapter.observers addObjectsFromArray:@[wake, active]];
    }
}

char *cadence_native_events(void) {
    @autoreleasepool {
        @synchronized(adapter) {
            char *result = encode(adapter.events ?: @[]);
            [adapter.events removeAllObjects];
            return result;
        }
    }
}

void cadence_native_free(char *value) { free(value); }

static NSArray<UNNotificationRequest *> *pending(UNUserNotificationCenter *center) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block NSArray *requests;
    [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray *value) {
        requests = value;
        dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) return nil;
    return requests;
}

static NSDictionary *pendingResult(UNUserNotificationCenter *center, NSArray *requested, NSArray *failures) {
    NSArray *requests = pending(center);
    if (!requests) return @{ @"error": @"macOS did not return pending notifications within 10 seconds. Scheduling outcome is unknown; refresh pending requests." };
    NSMutableArray *items = [NSMutableArray new];
    NSMutableSet *actualIds = [NSMutableSet new];
    for (UNNotificationRequest *request in requests) {
        if (!ownedIdentifier(request.identifier)) continue;
        NSDate *date = [request.trigger isKindOfClass:UNCalendarNotificationTrigger.class]
            ? ((UNCalendarNotificationTrigger *)request.trigger).nextTriggerDate : nil;
        [actualIds addObject:request.identifier];
        [items addObject:@{
            @"id": request.identifier,
            @"title": request.content.title,
            @"body": request.content.body,
            @"fireAt": date ? timestamp(date) : (id)NSNull.null
        }];
    }
    [items sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"id"] compare:b[@"id"]];
    }];
    NSMutableDictionary *result = [@{ @"pending": items } mutableCopy];
    if (requested) {
        NSMutableArray *missing = [NSMutableArray new];
        for (NSString *identifier in requested) if (![actualIds containsObject:identifier]) [missing addObject:identifier];
        result[@"requestedCount"] = @(requested.count);
        result[@"missingIds"] = missing;
        result[@"errors"] = failures ?: @[];
    }
    return result;
}

static NSDictionary *deliveredResult(UNUserNotificationCenter *center) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block NSArray<UNNotification *> *notifications;
    [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *value) {
        notifications = value;
        dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) {
        return @{ @"error": @"macOS did not return delivered notifications within 10 seconds. Delivery remains unverified; refresh delivered notifications." };
    }
    NSMutableArray *items = [NSMutableArray new];
    for (UNNotification *notification in notifications) {
        UNNotificationRequest *request = notification.request;
        if (!ownedIdentifier(request.identifier)) continue;
        [items addObject:@{
            @"id": request.identifier,
            @"title": request.content.title,
            @"body": request.content.body,
            @"fireAt": requestFireDate(request) ? timestamp(requestFireDate(request)) : (id)NSNull.null,
            @"deliveredAt": timestamp(notification.date)
        }];
    }
    [items sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"id"] compare:b[@"id"]];
    }];
    return @{ @"delivered": items };
}

static NSDictionary *status(UNUserNotificationCenter *center) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block UNNotificationSettings *settings;
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *value) {
        settings = value;
        dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) {
        return @{ @"error": @"macOS did not return notification settings within 10 seconds." };
    }
    NSString *authorization = @"unknown";
    switch (settings.authorizationStatus) {
        case UNAuthorizationStatusNotDetermined: authorization = @"notDetermined"; break;
        case UNAuthorizationStatusDenied: authorization = @"denied"; break;
        case UNAuthorizationStatusAuthorized: authorization = @"authorized"; break;
        case UNAuthorizationStatusProvisional: authorization = @"provisional"; break;
        default: break;
    }
    return @{ @"authorization": authorization, @"bundleIdentifier": NSBundle.mainBundle.bundleIdentifier };
}

static NSDictionary *execute(NSDictionary *input) {
    if (!NSBundle.mainBundle.bundleIdentifier.length) {
        return @{ @"error": @"Open the packaged Cadence Desktop Spike.app to test native notifications; a raw executable has no application identity." };
    }
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    NSString *operation = input[@"operation"];
    if ([operation isEqualToString:@"status"]) return status(center);
    if ([operation isEqualToString:@"requestPermission"]) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSError *failure;
        [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
            completionHandler:^(BOOL granted, NSError *error) {
                (void)granted;
                failure = error;
                dispatch_semaphore_signal(semaphore);
            }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC))) {
            return @{ @"error": @"Notification permission is still pending. Answer the macOS prompt, then refresh permission status." };
        }
        if (failure) return @{ @"error": failure.localizedDescription };
        return status(center);
    }
    if ([operation isEqualToString:@"pending"]) return pendingResult(center, nil, nil);
    if ([operation isEqualToString:@"delivered"]) return deliveredResult(center);
    if ([operation isEqualToString:@"cancel"] || [operation isEqualToString:@"cancelPending"]) {
        [center removePendingNotificationRequestsWithIdentifiers:input[@"ids"]];
        if ([operation isEqualToString:@"cancel"]) [center removeDeliveredNotificationsWithIdentifiers:input[@"ids"]];
        return pendingResult(center, nil, nil);
    }
    if (![operation isEqualToString:@"schedule"]) return @{ @"error": @"Unknown native operation." };

    NSDictionary *permission = status(center);
    if (permission[@"error"]) return permission;
    if (![permission[@"authorization"] isEqualToString:@"authorized"] &&
        ![permission[@"authorization"] isEqualToString:@"provisional"]) {
        return @{ @"error": @"Notification permission is not granted. Request permission explicitly before scheduling." };
    }

    NSMutableArray *requests = [NSMutableArray new];
    NSMutableArray *ids = [NSMutableArray new];
    NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
    NSCalendar *calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
    calendar.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
    for (NSDictionary *item in input[@"reminders"]) {
        formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
        NSDate *date = [formatter dateFromString:item[@"fireAt"]];
        if (!date) {
            formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
            date = [formatter dateFromString:item[@"fireAt"]];
        }
        NSTimeInterval interval = [date timeIntervalSinceNow];
        if (!date || interval < 1 || interval > 31 * 24 * 60 * 60) {
            return @{ @"error": @"Every reminder must specify a valid future instant between one second and 31 days away. Nothing was scheduled." };
        }
        UNMutableNotificationContent *content = [UNMutableNotificationContent new];
        content.title = item[@"title"];
        content.body = item[@"body"];
        content.sound = UNNotificationSound.defaultSound;
        NSDateComponents *components = [calendar components:NSCalendarUnitYear | NSCalendarUnitMonth |
            NSCalendarUnitDay | NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond fromDate:date];
        components.calendar = calendar;
        components.timeZone = calendar.timeZone;
        UNCalendarNotificationTrigger *trigger = [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
        [requests addObject:[UNNotificationRequest requestWithIdentifier:item[@"id"] content:content trigger:trigger]];
        [ids addObject:item[@"id"]];
    }

    // macOS owns delivery after quit. Read every ID back; no assumed iOS limit or silent truncation.
    NSMutableArray *failures = [NSMutableArray new];
    for (UNNotificationRequest *request in requests) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSError *failure;
        [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
            failure = error;
            dispatch_semaphore_signal(semaphore);
        }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) {
            [failures addObject:@{ @"id": request.identifier, @"error": @"Scheduling timed out; outcome unknown." }];
            break;
        }
        if (failure) [failures addObject:@{ @"id": request.identifier, @"error": failure.localizedDescription }];
    }
    return pendingResult(center, ids, failures);
}

char *cadence_native_request(const char *input) {
    @autoreleasepool {
        @try {
            NSData *data = [[NSString stringWithUTF8String:input] dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if (![request isKindOfClass:NSDictionary.class]) return encode(@{ @"error": @"Invalid native request." });
            return encode(execute(request));
        } @catch (NSException *exception) {
            return encode(@{ @"error": exception.reason ?: @"Native notification operation failed." });
        }
    }
}
