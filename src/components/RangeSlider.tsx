import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  GestureResponderEvent,
  Platform,
} from 'react-native';

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unitLabel: string;
  onChange: (val: number) => void;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  unitLabel,
  onChange,
}) => {
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const trackRef = useRef<View>(null);

  const safeMax = Math.max(min + 1, max);
  const clampedValue = Math.min(safeMax, Math.max(min, value));
  const progress = (clampedValue - min) / (safeMax - min || 1);

  // Keep latest values in refs to prevent stale closure issues in PanResponder
  const trackWidthRef = useRef<number>(0);
  const trackPageXRef = useRef<number>(0);
  const safeMaxRef = useRef<number>(safeMax);
  const minRef = useRef<number>(min);
  const stepRef = useRef<number>(step);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    trackWidthRef.current = trackWidth;
    safeMaxRef.current = safeMax;
    minRef.current = min;
    stepRef.current = step;
    onChangeRef.current = onChange;
  });

  // WEB BROWSER IMPLEMENTATION (Desktop PC & Mobile Web Mouse/Touch)
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.webSliderWrapper}>
          {React.createElement('input', {
            type: 'range',
            min: min,
            max: safeMax,
            step: step,
            value: clampedValue,
            onChange: (e: any) => onChange(Number(e.target.value)),
            style: {
              width: '100%',
              height: '36px',
              accentColor: '#38bdf8',
              cursor: 'pointer',
              background: 'transparent',
              outline: 'none',
            },
          })}
        </View>

        {/* Scale Tick Labels */}
        <View style={styles.scaleRow}>
          <Text style={styles.scaleLabel}>{min} {unitLabel}</Text>
          <Text style={styles.scaleCenterLabel}>
            {Math.round(safeMax / 2)} {unitLabel} (50%)
          </Text>
          <Text style={[styles.scaleLabel, { color: '#38bdf8', fontWeight: '800' }]}>
            Max: {safeMax} {unitLabel}
          </Text>
        </View>
      </View>
    );
  }

  // NATIVE MOBILE IMPLEMENTATION (Android & iOS)
  const updateFromNativeEvent = (evt: GestureResponderEvent) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;

    let x = evt.nativeEvent.locationX;
    if (trackPageXRef.current > 0 && evt.nativeEvent.pageX !== undefined) {
      x = evt.nativeEvent.pageX - trackPageXRef.current;
    }

    const minVal = minRef.current;
    const maxVal = safeMaxRef.current;
    const stepVal = stepRef.current || 1;

    const pct = Math.max(0, Math.min(1, x / width));
    const rawVal = minVal + pct * (maxVal - minVal);
    const steppedVal = Math.round(rawVal / stepVal) * stepVal;
    onChangeRef.current(Math.min(maxVal, Math.max(minVal, steppedVal)));
  };

  const measureTrack = () => {
    if (trackRef.current) {
      trackRef.current.measure((_x, _y, width, _height, pageX) => {
        if (width > 0) {
          trackWidthRef.current = width;
          setTrackWidth(width);
        }
        if (pageX !== undefined && pageX > 0) {
          trackPageXRef.current = pageX;
        }
      });
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          measureTrack();
          updateFromNativeEvent(evt);
        },
        onPanResponderMove: (evt) => {
          updateFromNativeEvent(evt);
        },
      }),
    []
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0) {
      trackWidthRef.current = width;
      setTrackWidth(width);
    }
    measureTrack();
  };

  return (
    <View style={styles.container}>
      {/* Slider Track with Touch Responder */}
      <View
        ref={trackRef}
        style={styles.touchArea}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        {/* Inactive Track */}
        <View style={styles.trackBackground} pointerEvents="none">
          {/* Active Fill Track */}
          <View
            style={[styles.trackFill, { width: `${progress * 100}%` }]}
            pointerEvents="none"
          />
        </View>

        {/* Thumb Knob */}
        <View
          style={[
            styles.thumb,
            {
              left: `${progress * 100}%`,
              transform: [{ translateX: -16 }],
            },
          ]}
          pointerEvents="none"
        >
          <View style={styles.thumbInner} pointerEvents="none" />
        </View>
      </View>

      {/* Scale Tick Labels */}
      <View style={styles.scaleRow}>
        <Text style={styles.scaleLabel}>{min} {unitLabel}</Text>
        <Text style={styles.scaleCenterLabel}>
          {Math.round(safeMax / 2)} {unitLabel} (50%)
        </Text>
        <Text style={[styles.scaleLabel, { color: '#38bdf8', fontWeight: '800' }]}>
          Max: {safeMax} {unitLabel}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  webSliderWrapper: {
    paddingVertical: 4,
    justifyContent: 'center',
  },
  touchArea: {
    height: 48,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    height: 10,
    backgroundColor: '#0f172a',
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 5,
  },
  thumb: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 3.5,
    borderColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  thumbInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0284c7',
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    paddingHorizontal: 2,
  },
  scaleLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  scaleCenterLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
});
