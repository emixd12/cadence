#import <AppKit/AppKit.h>
#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>
#import <os/log.h>

@interface CadenceLocation : NSObject <CLLocationManagerDelegate>
@property CLLocationManager *manager;
@property(copy) void (^complete)(NSDictionary *);
- (void)finish:(NSDictionary *)value;
@end

@implementation CadenceLocation
- (void)finish:(NSDictionary *)value {
    if (!self.complete) return;
    void (^callback)(NSDictionary *) = self.complete;
    self.complete = nil;
    os_log_info(OS_LOG_DEFAULT, "cadence location result %{public}@ reason %{public}@", value[@"state"], value[@"reason"] ?: @"none");
    self.manager.delegate = nil;
    [self.manager stopUpdatingLocation];
    callback(value);
}
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
    if (manager.authorizationStatus == kCLAuthorizationStatusAuthorizedAlways) {
        if (NSApp.active) [manager requestLocation];
        else [self finish:@{@"state": @"unavailable", @"reason": @"inactive"}];
    } else if (manager.authorizationStatus != kCLAuthorizationStatusNotDetermined) {
        [self finish:@{@"state": @"denied", @"reason": [NSString stringWithFormat:@"status_%d", (int)manager.authorizationStatus]}];
    }
}
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
    CLLocation *location = locations.lastObject;
    if (!NSApp.active) { [self finish:@{@"state": @"unavailable", @"reason": @"inactive"}]; return; }
    if (!location || !CLLocationCoordinate2DIsValid(location.coordinate)) {
        [self finish:@{@"state": @"unavailable", @"reason": @"invalid_location"}]; return;
    }
    [self finish:@{@"state": @"available", @"latitude": @(location.coordinate.latitude),
        @"longitude": @(location.coordinate.longitude), @"accuracyMeters": @(location.horizontalAccuracy),
        @"sampledAt": @([location.timestamp timeIntervalSince1970] * 1000)}];
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    NSString *reason = [error.domain isEqualToString:kCLErrorDomain]
        ? [NSString stringWithFormat:@"cl_error_%ld", (long)error.code]
        : [NSString stringWithFormat:@"error_%@_%ld", error.domain, (long)error.code];
    BOOL denied = [error.domain isEqualToString:kCLErrorDomain] && error.code == kCLErrorDenied;
    [self finish:@{@"state": denied ? @"denied" : @"unavailable", @"reason": reason}];
}
@end

// Called on a Rust blocking worker. Reading authorization never requests a position
// or presents a permission dialog, even while a foreground request is in flight.
int cadence_location_permission(void) {
    // The service query can contact locationd; keep it off the UI thread.
    if (![CLLocationManager locationServicesEnabled]) return -1;
    __block int status = 0;
    dispatch_sync(dispatch_get_main_queue(), ^{
        CLLocationManager *manager = [CLLocationManager new];
        status = (int)manager.authorizationStatus;
    });
    return status;
}

// Called on a Rust blocking worker. Core Location stays on the main run loop.
char *cadence_location_request(bool requestPermission) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSDictionary *result = @{@"state": @"unavailable"};
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!NSApp.active) {
            result = @{@"state": @"unavailable", @"reason": @"inactive"};
            os_log_info(OS_LOG_DEFAULT, "cadence location result %{public}@ reason %{public}@", @"unavailable", @"inactive");
            dispatch_semaphore_signal(done); return;
        }
        if (![CLLocationManager locationServicesEnabled]) {
            result = @{@"state": @"unavailable", @"reason": @"services_off"};
            os_log_info(OS_LOG_DEFAULT, "cadence location result %{public}@ reason %{public}@", @"unavailable", @"services_off");
            dispatch_semaphore_signal(done); return;
        }
        CadenceLocation *adapter = [CadenceLocation new];
        adapter.manager = [CLLocationManager new];
        adapter.manager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
        adapter.complete = ^(NSDictionary *value) { result = value; dispatch_semaphore_signal(done); };
        CLAuthorizationStatus status = adapter.manager.authorizationStatus;
        if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) {
            [adapter finish:@{@"state": @"denied", @"reason": [NSString stringWithFormat:@"status_%d", (int)status]}]; return;
        }
        if (status == kCLAuthorizationStatusNotDetermined && !requestPermission) {
            [adapter finish:@{@"state": @"prompt"}]; return;
        }
        adapter.manager.delegate = adapter;
        if (status == kCLAuthorizationStatusNotDetermined) [adapter.manager requestWhenInUseAuthorization];
        else [adapter.manager requestLocation];
        // This block retains the one-shot adapter until completion or deadline.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 12 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            [adapter finish:@{@"state": @"unavailable", @"reason": @"timeout"}];
        });
    });
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
