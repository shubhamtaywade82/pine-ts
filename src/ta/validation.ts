export const requirePositiveLength = (length: number): void => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
};
