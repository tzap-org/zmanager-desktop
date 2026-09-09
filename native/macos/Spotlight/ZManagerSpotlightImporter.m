#import <CoreFoundation/CoreFoundation.h>
#import <CoreFoundation/CFPlugInCOM.h>
#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>
#import <Metadata/MDImporter.h>

// UniFFI-generated C surface for zmanager-ffi (synced from the sibling
// zmanager checkout by scripts/sync-uniffi-swift-bindings.sh). The
// implementation is linked from libzmanager_ffi.a.
#import "zmanagerFFI.h"

static NSString *const ZMTzapUTI = @"org.tzap-org.zmanager.tzap";
static NSString *const ZMSignatureStatus = @"com_frankmanzhu_zmanager_tzapSignatureStatus";
static NSString *const ZMSigner = @"com_frankmanzhu_zmanager_tzapSigner";
static NSString *const ZMIssuer = @"com_frankmanzhu_zmanager_tzapIssuer";
static NSString *const ZMEncryption = @"com_frankmanzhu_zmanager_tzapEncryption";
static NSString *const ZMVolumeCount = @"com_frankmanzhu_zmanager_tzapVolumeCount";

typedef struct {
    MDImporterInterfaceStruct *interface;
    CFUUIDRef factoryID;
    UInt32 refCount;
} ZMMetadataImporterPlugin;

static CFUUIDRef ZMFactoryID(void) {
    return CFUUIDGetConstantUUIDWithBytes(
        kCFAllocatorDefault,
        0xC4, 0x83, 0xC0, 0x10, 0x8E, 0x7F, 0x45, 0x8A,
        0xA7, 0x92, 0x48, 0xC5, 0xC6, 0xC1, 0x94, 0xDA
    );
}

static NSDictionary *ZMDictionary(NSDictionary *dictionary, NSString *key) {
    id value = dictionary[key];
    return [value isKindOfClass:NSDictionary.class] ? value : @{};
}

static NSString *ZMString(NSDictionary *dictionary, NSString *key) {
    id value = dictionary[key];
    if (![value isKindOfClass:NSString.class] || [value length] == 0 || [value length] > 4096) {
        return nil;
    }
    return value;
}

static void ZMSet(CFMutableDictionaryRef attributes, NSString *key, NSString *value) {
    if (value.length > 0) {
        CFDictionarySetValue(attributes, (__bridge CFStringRef)key, (__bridge CFStringRef)value);
    }
}

// Calls the UniFFI tzapPublicMetadataDisplaySummary entry point through the
// generated zmanagerFFI C ABI. The path and result are RustBuffer-marshaled;
// the caller-owned buffers are released here. Returns the JSON envelope, or
// nil if the call itself failed.
static NSString *ZMSummaryJSON(NSString *path) {
    const char *pathBytes = path.fileSystemRepresentation;
    size_t pathLength = strlen(pathBytes);
    RustCallStatus callStatus = {0};
    RustBuffer pathBuffer = ffi_zmanager_ffi_rustbuffer_alloc((uint64_t)pathLength, &callStatus);
    if (callStatus.code != 0) {
        return nil;
    }
    memcpy(pathBuffer.data, pathBytes, pathLength);
    pathBuffer.len = (uint64_t)pathLength;
    RustBuffer result = uniffi_zmanager_ffi_fn_func_tzappublicmetadatadisplaysummary(pathBuffer, &callStatus);
    // UniFFI consumes the input RustBuffer when the function is called. Do
    // not free pathBuffer here; freeing it again aborts mdworker on macOS.
    if (callStatus.code != 0) {
        if (callStatus.errorBuf.data != NULL) {
            ffi_zmanager_ffi_rustbuffer_free(callStatus.errorBuf, &callStatus);
        }
        return nil;
    }
    NSString *json = [[NSString alloc] initWithBytes:result.data length:result.len encoding:NSUTF8StringEncoding];
    ffi_zmanager_ffi_rustbuffer_free(result, &callStatus);
    return json;
}

static Boolean GetMetadataForFile(
    void *thisInterface,
    CFMutableDictionaryRef attributes,
    CFStringRef contentTypeUTI,
    CFStringRef pathToFile
) {
    (void)thisInterface;
    @autoreleasepool {
        if (![(__bridge NSString *)contentTypeUTI isEqualToString:ZMTzapUTI]) {
            return false;
        }
        NSString *path = (__bridge NSString *)pathToFile;
        NSString *json = ZMSummaryJSON(path);
        NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
        if (data.length == 0 || data.length > 1048576) {
            return false;
        }
        NSDictionary *root = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![root isKindOfClass:NSDictionary.class] || ![root[@"ok"] boolValue]) {
            return false;
        }
        NSDictionary *metadata = ZMDictionary(root, @"metadata");
        NSDictionary *format = ZMDictionary(metadata, @"format");
        NSDictionary *signature = ZMDictionary(root, @"signature");
        NSDictionary *rootAuth = ZMDictionary(signature, @"root_auth");
        NSString *signatureCode = ZMString(signature, @"status");
        NSString *status = [signatureCode isEqualToString:@"signed"]
            ? @"Signature authentic"
            : ([signatureCode isEqualToString:@"unsigned"] ? @"No signature"
               : ([signatureCode isEqualToString:@"not_authentic"] ? @"Signature not authentic" : @"Archive unreadable"));
        NSString *signer = ZMString(rootAuth, @"subject");
        NSString *issuer = ZMString(rootAuth, @"issuer");
        NSString *encryption = ZMString(format, @"encryption_algorithm");
        NSNumber *volumeCount = [metadata[@"expected_volume_count"] isKindOfClass:NSNumber.class]
            ? metadata[@"expected_volume_count"] : nil;

        ZMSet(attributes, ZMSignatureStatus, status);
        ZMSet(attributes, ZMSigner, signer);
        ZMSet(attributes, ZMIssuer, issuer);
        ZMSet(attributes, ZMEncryption, encryption);
        if (volumeCount != nil) {
            CFDictionarySetValue(attributes, (__bridge CFStringRef)ZMVolumeCount, (__bridge CFNumberRef)volumeCount);
        }
        ZMSet(attributes, (__bridge NSString *)kMDItemSecurityMethod, status);
        ZMSet(attributes, (__bridge NSString *)kMDItemKind, @"TZAP archive");
        ZMSet(attributes, (__bridge NSString *)kMDItemDescription,
              signer.length > 0 ? [NSString stringWithFormat:@"TZAP archive signed by %@", signer] : @"TZAP archive");
        if (signer.length > 0) {
            CFDictionarySetValue(attributes, kMDItemAuthors, (__bridge CFArrayRef)@[signer]);
        }
        return true;
    }
}

static HRESULT ZMQueryInterface(void *instance, REFIID iid, LPVOID *output) {
    if (output == NULL) return E_POINTER;
    CFUUIDRef interfaceID = CFUUIDCreateFromUUIDBytes(kCFAllocatorDefault, iid);
    if (CFEqual(interfaceID, kMDImporterInterfaceID) || CFEqual(interfaceID, IUnknownUUID)) {
        ((ZMMetadataImporterPlugin *)instance)->interface->AddRef(instance);
        *output = instance;
        CFRelease(interfaceID);
        return S_OK;
    }
    *output = NULL;
    CFRelease(interfaceID);
    return E_NOINTERFACE;
}

static ULONG ZMAddRef(void *instance) {
    return ++((ZMMetadataImporterPlugin *)instance)->refCount;
}

static ULONG ZMRelease(void *instance) {
    ZMMetadataImporterPlugin *plugin = instance;
    UInt32 count = --plugin->refCount;
    if (count == 0) {
        CFPlugInRemoveInstanceForFactory(plugin->factoryID);
        CFRelease(plugin->factoryID);
        free(plugin);
    }
    return count;
}

static MDImporterInterfaceStruct ZMImporterInterface = {
    NULL, ZMQueryInterface, ZMAddRef, ZMRelease, GetMetadataForFile,
};

void *MetadataImporterPluginFactory(CFAllocatorRef allocator, CFUUIDRef typeID) {
    (void)allocator;
    if (!CFEqual(typeID, kMDImporterTypeID)) return NULL;
    ZMMetadataImporterPlugin *plugin = calloc(1, sizeof(ZMMetadataImporterPlugin));
    if (plugin == NULL) return NULL;
    plugin->interface = &ZMImporterInterface;
    plugin->factoryID = CFRetain(ZMFactoryID());
    plugin->refCount = 1;
    CFPlugInAddInstanceForFactory(plugin->factoryID);
    return plugin;
}
