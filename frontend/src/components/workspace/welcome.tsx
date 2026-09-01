"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

function WelcomeDescription({ children }: { children: string }) {
  return (
    <p className="max-w-full text-wrap break-words whitespace-pre-line">
      {children}
    </p>
  );
}

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "swarm" | "architect" | "reflect" | "swift";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  useEffect(() => {
    waved = true;
  }, []);
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-full flex-col items-center justify-center gap-2 px-4 py-4 text-center sm:px-8",
        className,
      )}
    >
      <div className="max-w-full text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
        {searchParams.get("mode") === "skill" ? (
          `✨ ${t.welcome.createYourOwnSkill} ✨`
        ) : (
          <div className="flex max-w-full flex-col items-center gap-3">
            <AuroraText
              colors={["#a7f3d0", "#34d399", "#059669", "#a7f3d0"]}
              className="drop-shadow-[0_0_25px_rgba(52,211,153,0.45)]"
            >
              {t.welcome.greeting}
            </AuroraText>
          </div>
        )}
      </div>
      {searchParams.get("mode") === "skill" && (
        <div className="text-muted-foreground max-w-full text-sm">
          <WelcomeDescription>
            {t.welcome.createYourOwnSkillDescription}
          </WelcomeDescription>
        </div>
      )}
    </div>
  );
}
