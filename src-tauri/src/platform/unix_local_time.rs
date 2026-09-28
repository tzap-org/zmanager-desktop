use std::time::{SystemTime, UNIX_EPOCH};

/// Formats `time` in the user's local time zone as `YYYY-MM-DD HH:MM:SS`.
pub(super) fn format_local_time(time: SystemTime) -> Option<String> {
    // Whole seconds, rounding pre-epoch times down like `localtime` expects.
    let seconds = match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_secs()).ok()?,
        Err(before) => {
            let before = before.duration();
            -i64::try_from(before.as_secs() + u64::from(before.subsec_nanos() > 0)).ok()?
        }
    };
    let seconds = libc::time_t::try_from(seconds).ok()?;
    // SAFETY: `tm` is a plain C struct for which all-zero is a valid value.
    let mut local: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: `localtime_r` only writes the caller-owned `local`.
    if unsafe { libc::localtime_r(&seconds, &mut local) }.is_null() {
        return None;
    }
    Some(format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        i64::from(local.tm_year) + 1900,
        local.tm_mon + 1,
        local.tm_mday,
        local.tm_hour,
        local.tm_min,
        local.tm_sec
    ))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn assert_timestamp_shape(value: &str) {
        let bytes = value.as_bytes();
        assert_eq!(bytes.len(), 19, "{value}");
        for (index, byte) in bytes.iter().enumerate() {
            match index {
                4 | 7 => assert_eq!(*byte, b'-', "{value}"),
                10 => assert_eq!(*byte, b' ', "{value}"),
                13 | 16 => assert_eq!(*byte, b':', "{value}"),
                _ => assert!(byte.is_ascii_digit(), "{value}"),
            }
        }
    }

    #[test]
    fn formats_local_time_as_date_and_time() {
        // Mid-2023 in every time zone, whatever the test machine's offset.
        let formatted = format_local_time(UNIX_EPOCH + Duration::from_secs(1_688_000_000)).expect("local time");
        assert_timestamp_shape(&formatted);
        assert!(formatted.starts_with("2023-06-2"), "{formatted}");
    }

    #[test]
    fn keeps_the_seconds_of_the_local_time() {
        // Time-zone offsets are whole minutes, so the seconds survive conversion.
        let formatted = format_local_time(UNIX_EPOCH + Duration::from_millis(1_688_000_042_900)).expect("local time");
        assert!(formatted.ends_with(":02"), "{formatted}");
    }

    #[test]
    fn formats_times_before_the_epoch() {
        let formatted = format_local_time(UNIX_EPOCH - Duration::from_secs(86_400 * 180)).expect("local time");
        assert_timestamp_shape(&formatted);
        assert!(formatted.starts_with("1969-"), "{formatted}");
    }
}
