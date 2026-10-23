use asteroids_verifier_core::tape::parse_tape_ref;
use asteroids_verifier_core::{verify_tape, VerifyError};
use sdk::*;

/// Max frames accepted on chain (10 minutes at 60 fps).
pub const MAX_FRAMES: u32 = 36_000;

#[derive(Debug)]
#[sdk::storage]
pub struct Contract {}

/// A tape that failed verification. `code` names the `VerifyError` variant (see `error_code`);
/// `detail` carries the frame number for rule violations and 0 otherwise.
#[contract_exception]
pub struct ReplayFailed {
    pub code: u32,
    pub detail: u32,
}

fn error_code(err: &VerifyError) -> ReplayFailed {
    let (code, detail) = match err {
        VerifyError::TapeTooShort { .. } => (1, 0),
        VerifyError::InvalidMagic { .. } => (2, 0),
        VerifyError::UnsupportedVersion { .. } => (3, 0),
        VerifyError::UnknownRulesTag { .. } => (4, 0),
        VerifyError::HeaderReservedNonZero => (5, 0),
        VerifyError::FrameCountOutOfRange { .. } => (6, 0),
        VerifyError::TapeLengthMismatch { .. } => (7, 0),
        VerifyError::CrcMismatch { .. } => (8, 0),
        VerifyError::RuleViolation { frame, .. } => (9, *frame),
        VerifyError::FrameCountMismatch { .. } => (10, 0),
        VerifyError::ScoreMismatch { .. } => (11, 0),
    };
    ReplayFailed { code, detail }
}

#[contract]
impl Contract {
    /// Strict replay of a whole tape. Returns the verified final score.
    pub fn replay(&self, tape: &[u8]) -> u32 {
        match verify_tape(tape, MAX_FRAMES) {
            Ok(verified) => verified.final_score,
            Err(err) => throw(error_code(&err)),
        }
    }

    /// Container checks and CRC only (no replay). Returns the frame count.
    pub fn parse_only(&self, tape: &[u8]) -> u32 {
        match parse_tape_ref(tape, MAX_FRAMES) {
            Ok(parsed) => parsed.frame_count,
            Err(err) => throw(error_code(&err)),
        }
    }

    /// Strict replay plus guest memory measurement. Returns
    /// `[score, heap_used, stack_used, heap_base, stack_top]` in bytes. RV32 only (zeros on host).
    pub fn memory_probe(&self, tape: &[u8]) -> [u32; 5] {
        let painted = mem::paint_stack();
        let score = self.replay(tape);
        let stack_used = mem::stack_used(painted);
        let (heap_used, heap_base) = mem::heap_used();
        [score, heap_used, stack_used, heap_base, mem::stack_top()]
    }

    /// Calldata baseline: returns the tape length without reading it.
    pub fn noop(&self, tape: &[u8]) -> u32 {
        tape.len() as u32
    }
}

#[cfg(target_arch = "riscv32")]
mod mem {
    const PAINT: u8 = 0xA5;
    // Bytes left untouched just below the live stack pointer (red zone for this frame).
    const GUARD: usize = 256;

    unsafe extern "C" {
        static __stack_bottom: u8;
        static __stack_top: u8;
        static __heap_base: u8;
    }

    fn sp() -> usize {
        let sp: usize;
        unsafe { core::arch::asm!("mv {0}, sp", out(reg) sp) };
        sp
    }

    pub fn stack_top() -> u32 {
        (&raw const __stack_top) as u32
    }

    /// Fills the unused stack below the current frame. Returns the lowest painted address.
    #[inline(never)]
    pub fn paint_stack() -> usize {
        // Start above the null guard; the stack reserve begins at address 0.
        let bottom = core::cmp::max((&raw const __stack_bottom) as usize, 16);
        let top = sp() - GUARD;
        for addr in bottom..top {
            unsafe { core::ptr::write_volatile(addr as *mut u8, PAINT) };
        }
        bottom
    }

    /// Bytes of stack ever used, from the lowest overwritten painted byte to the stack top.
    #[inline(never)]
    pub fn stack_used(bottom: usize) -> u32 {
        let top = (&raw const __stack_top) as usize;
        let mut addr = bottom;
        while addr < top && unsafe { core::ptr::read_volatile(addr as *const u8) } == PAINT {
            addr += 1;
        }
        (top - addr) as u32
    }

    /// Bytes handed out by the bump allocator so far (it never frees, so this is the peak).
    pub fn heap_used() -> (u32, u32) {
        let base = (&raw const __heap_base) as usize;
        let probe = unsafe { alloc::alloc::alloc(core::alloc::Layout::new::<u8>()) } as usize;
        ((probe - base) as u32, base as u32)
    }
}

#[cfg(not(target_arch = "riscv32"))]
mod mem {
    pub fn paint_stack() -> usize {
        0
    }
    pub fn stack_used(_bottom: usize) -> u32 {
        0
    }
    pub fn heap_used() -> (u32, u32) {
        (0, 0)
    }
    pub fn stack_top() -> u32 {
        0
    }
}
