//! Fixed-capacity, inline vector used for per-frame entity storage.
//!
//! The on-chain guest has a bump allocator that never frees, so the simulation must not
//! allocate while stepping. `FixedVec` keeps the exact element-order semantics the sim relied
//! on from `Vec`: `push` appends at the end and `retain` is a stable in-place compaction that
//! visits every element once, in order.

use core::ops::{Deref, DerefMut};

#[derive(Clone, Copy)]
pub(crate) struct FixedVec<T: Copy, const N: usize> {
    items: [T; N],
    len: usize,
    /// Largest length ever reached (tests use it to check the capacity bounds).
    #[cfg(test)]
    pub(crate) peak: usize,
}

impl<T: Copy, const N: usize> FixedVec<T, N> {
    /// Creates an empty vector. `fill` only initializes the unused slots; it is never observable.
    #[inline]
    pub(crate) const fn new(fill: T) -> Self {
        Self {
            items: [fill; N],
            len: 0,
            #[cfg(test)]
            peak: 0,
        }
    }

    /// Appends `value`.
    ///
    /// The simulation proves every call site stays within capacity (see the `*_VEC_CAPACITY`
    /// constants in `sim`), so overflow is a logic error and aborts the replay.
    #[inline]
    pub(crate) fn push(&mut self, value: T) {
        assert!(self.len < N, "FixedVec capacity exceeded");
        self.items[self.len] = value;
        self.len += 1;
        #[cfg(test)]
        {
            self.peak = core::cmp::max(self.peak, self.len);
        }
    }

    /// Keeps only the elements for which `keep` returns true, preserving their order.
    #[inline]
    pub(crate) fn retain<F: FnMut(&T) -> bool>(&mut self, mut keep: F) {
        let mut write = 0;
        for read in 0..self.len {
            let item = self.items[read];
            if keep(&item) {
                self.items[write] = item;
                write += 1;
            }
        }
        self.len = write;
    }

    #[cfg(test)]
    #[inline]
    pub(crate) fn clear(&mut self) {
        self.len = 0;
    }
}

impl<T: Copy, const N: usize> Deref for FixedVec<T, N> {
    type Target = [T];

    #[inline]
    fn deref(&self) -> &[T] {
        &self.items[..self.len]
    }
}

impl<T: Copy, const N: usize> DerefMut for FixedVec<T, N> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.items[..self.len]
    }
}

impl<'a, T: Copy, const N: usize> IntoIterator for &'a FixedVec<T, N> {
    type Item = &'a T;
    type IntoIter = core::slice::Iter<'a, T>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a, T: Copy, const N: usize> IntoIterator for &'a mut FixedVec<T, N> {
    type Item = &'a mut T;
    type IntoIter = core::slice::IterMut<'a, T>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retain_matches_vec_retain_order() {
        let source = [5u32, 1, 8, 3, 9, 2, 7, 4, 6, 0];
        for mask in 0u32..(1 << source.len()) {
            let keep = |value: &u32| (mask >> *value) & 1 == 1;

            let mut expected = source.to_vec();
            expected.retain(keep);

            let mut actual: FixedVec<u32, 12> = FixedVec::new(0);
            for value in source {
                actual.push(value);
            }
            actual.retain(keep);

            assert_eq!(&actual[..], &expected[..]);
        }
    }

    #[test]
    #[should_panic(expected = "FixedVec capacity exceeded")]
    fn push_past_capacity_aborts() {
        let mut values: FixedVec<u8, 2> = FixedVec::new(0);
        values.push(1);
        values.push(2);
        values.push(3);
    }
}
