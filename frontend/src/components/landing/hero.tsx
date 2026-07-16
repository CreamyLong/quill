"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { WordRotate } from "@/components/ui/word-rotate";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center",
        className,
      )}
    >
      {/* Aurora gradient background (replaces original Galaxy) */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -left-1/4 top-0 h-[60vh] w-[60vh] animate-[drift_20s_ease-in-out_infinite] rounded-full bg-primary/20 blur-[100px]" />
        <div className="absolute -right-1/4 top-1/4 h-[50vh] w-[50vh] animate-[drift_25s_ease-in-out_infinite_reverse] rounded-full bg-emerald-500/15 blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 h-[40vh] w-[40vh] animate-[drift_22s_ease-in-out_infinite] rounded-full bg-teal-400/10 blur-[80px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/30 to-background" />
      </div>
      <FlickeringGrid
        className="absolute inset-0 z-0 translate-y-8 mask-[url(/images/feather.svg)] mask-size-[100vw] mask-center mask-no-repeat md:mask-size-[72vh]"
        squareSize={4}
        gridGap={4}
        color={"white"}
        maxOpacity={0.3}
        flickerChance={0.25}
      />
      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-center">
        <h1 className="flex items-center gap-2 text-4xl font-bold md:text-6xl">
          <WordRotate
            words={[
              "Deep Research",
              "Collect Data",
              "Analyze Data",
              "Generate Webpages",
              "Vibe Coding",
              "Generate Slides",
              "Generate Images",
              "Generate Podcasts",
              "Generate Videos",
              "Generate Songs",
              "Organize Emails",
              "Do Anything",
              "Learn Anything",
            ]}
          />{" "}
          <div>with Quill</div>
        </h1>
        <p className="text-muted-foreground mt-8 scale-105 text-center text-2xl text-shadow-sm">
          An open-source SuperAgent harness that researches, codes, and creates.
          With
          <br />
          the help of sandboxes, memories, tools, skills and subagents, it
          handles
          <br />
          different levels of tasks that could take minutes to hours.
        </p>
        <Link href="/workspace">
          <Button className="size-lg mt-8 scale-108" size="lg">
            <span className="text-md">Get Started with 2.0</span>
            <ChevronRightIcon className="size-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
