//! lunix-core — the native heart of LUNIX.
//!
//! Compiled to wasm32-unknown-unknown with zero dependencies and loaded by
//! index.html at boot. The terminal degrades gracefully if this file is
//! missing; commands that need it will say so.
//!
//! ABI: flat C exports over linear memory. The JS side allocates, copies
//! bytes in, calls, reads results back. No wasm-bindgen, no glue runtime —
//! the whole module is what you see here.

#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    // abort: the host marks the instance trapped and unusable.
    loop {}
}

// ---------------------------------------------------------------- memory --

/// Bump allocator over a static 64 KiB arena. Single-call-at-a-time ABI:
/// the terminal is single-threaded for now (rayon lands later).
const ARENA_LEN: usize = 64 * 1024;
static mut ARENA: [u8; ARENA_LEN] = [0; ARENA_LEN];
static mut ARENA_POS: usize = 0;

#[no_mangle]
pub extern "C" fn lunix_abi() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn lunix_mem_alloc(len: u32) -> *mut u8 {
    let len = len as usize;
    unsafe {
        if len == 0 || ARENA_POS + len > ARENA_LEN {
            return core::ptr::null_mut();
        }
        let ptr = ARENA.as_mut_ptr().add(ARENA_POS);
        ARENA_POS += len;
        ptr
    }
}

#[no_mangle]
pub extern "C" fn lunix_mem_reset() {
    unsafe { ARENA_POS = 0 }
}

// --------------------------------------------------------------- version --

pub static VERSION: &[u8] = b"lunix-core 0.1.0 (wasm32, rustc)\0";

#[no_mangle]
pub extern "C" fn lunix_version_ptr() -> *const u8 {
    VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn lunix_version_len() -> u32 {
    (VERSION.len() - 1) as u32 // drop trailing NUL for JS friendliness
}

// ------------------------------------------------------- posix cksum(1) --

/// Byte-for-byte compatible with GNU coreutils `cksum` (POSIX algorithm:
/// CRC-32/CKSUM — polynomial 0x04C11DB7 processed MSB-first from a zero
/// register, the little-endian byte encoding of the length folded in while
/// significant, final complement).
static mut TABLE: [u32; 256] = [0; 256];
static mut TABLE_READY: bool = false;

fn table() -> &'static [u32; 256] {
    unsafe {
        if !TABLE_READY {
            let mut i = 0usize;
            while i < 256 {
                let mut c: u32 = (i as u32) << 24;
                let mut k = 0;
                while k < 8 {
                    c = if c & 0x8000_0000 != 0 { (c << 1) ^ 0x04C1_1DB7 } else { c << 1 };
                    k += 1;
                }
                TABLE[i] = c;
                i += 1;
            }
            TABLE_READY = true;
        }
        &*(&raw const TABLE)
    }
}

/// Returns the cksum checksum of `len` bytes at `ptr`.
#[no_mangle]
pub extern "C" fn lunix_cksum(ptr: *const u8, len: u32) -> u32 {
    let data = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
    let t = table();
    let mut crc: u32 = 0;
    for &b in data {
        crc = (crc << 8) ^ t[(((crc >> 24) as u8) ^ b) as usize];
    }
    let mut l = len as u64;
    while l != 0 {
        crc = (crc << 8) ^ t[(((crc >> 24) as u8) ^ (l as u8)) as usize];
        l >>= 8;
    }
    !crc
}

// ------------------------------------------------------------ fnv-1a 64 --

/// FNV-1a 64-bit — fast non-cryptographic hash used for cache keys and
/// history dedup. Not a security primitive; that's fine, it's not one there.
#[no_mangle]
pub extern "C" fn lunix_fnv1a64(ptr: *const u8, len: u32) -> u64 {
    let data = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01B3);
    }
    h
}
