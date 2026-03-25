import React, { useState, useCallback } from 'react';

interface DelayedInputControlProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  className?: string;
  disabled?: boolean;
}

export const DelayedInputControl: React.FC<DelayedInputControlProps> = ({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  precision = 2,
  className = '',
  disabled = false
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState<string | null>(null);
  // Track previous external value using state (derived state pattern)
  const [prevValue, setPrevValue] = useState(value);

  // Format value for display
  const formatValue = useCallback((val: number): string => {
    return precision > 0 ? val.toFixed(precision) : Math.round(val).toString();
  }, [precision]);

  // Reset local value when external value changes and not focused (derived state pattern)
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isFocused) {
      setLocalValue(null);
    }
  }

  // Display value: use local value when editing, otherwise format the prop value
  const displayValue = localValue !== null ? localValue : formatValue(value);

  // Handle input changes (visual only while typing)
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  // Handle commit (Enter key or blur)
  const handleCommit = useCallback(() => {
    const numValue = parseFloat(displayValue);
    if (!isNaN(numValue)) {
      // Apply min/max constraints
      let constrainedValue = numValue;
      if (min !== undefined) constrainedValue = Math.max(min, constrainedValue);
      if (max !== undefined) constrainedValue = Math.min(max, constrainedValue);

      onChange(constrainedValue);
    }
    // Reset local value to sync with prop
    setLocalValue(null);
  }, [displayValue, onChange, min, max]);

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLocalValue(null);
      (e.target as HTMLInputElement).blur();
    }
  }, [handleCommit]);

  // Handle focus events
  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    handleCommit();
  }, [handleCommit]);

  return (
    <input
      type="number"
      value={displayValue}
      onChange={handleInputChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={`w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50 focus:border-gray-600 focus:ring-1 focus:ring-gray-400 ${className}`}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
    />
  );
};

export default DelayedInputControl;