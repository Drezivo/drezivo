"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

export type DefaultMeasurementGuide = {
  name: string;
  previewUrl: string | null;
};

type MeasurementGuideContextValue = {
  guide: DefaultMeasurementGuide;
  saveGuide: (input: { name: string; file?: File }) => void;
};

const MeasurementGuideContext = createContext<MeasurementGuideContextValue | null>(null);

export function MeasurementGuideProvider({ children }: { children: ReactNode }) {
  const [guide, setGuide] = useState<DefaultMeasurementGuide>({
    name: "Luna's Standard Measurement Guide",
    previewUrl: null,
  });
  const ownedObjectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (ownedObjectUrl.current) URL.revokeObjectURL(ownedObjectUrl.current);
    },
    []
  );

  const saveGuide = ({ name, file }: { name: string; file?: File }) => {
    let nextPreviewUrl = guide.previewUrl;
    if (file) {
      if (ownedObjectUrl.current) URL.revokeObjectURL(ownedObjectUrl.current);
      nextPreviewUrl = URL.createObjectURL(file);
      ownedObjectUrl.current = nextPreviewUrl;
    }
    setGuide({ name, previewUrl: nextPreviewUrl });
  };

  return (
    <MeasurementGuideContext.Provider value={{ guide, saveGuide }}>
      {children}
    </MeasurementGuideContext.Provider>
  );
}

export function useMeasurementGuide(): MeasurementGuideContextValue {
  const value = useContext(MeasurementGuideContext);
  if (!value) throw new Error("useMeasurementGuide must be used inside MeasurementGuideProvider");
  return value;
}
