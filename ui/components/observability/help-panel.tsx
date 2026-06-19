"use client";
import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetScrollBody } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/documents/markdown-renderer";
import { OBSERVABILITY_HELP_MD } from "./help-content";

export function HelpPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader><SheetTitle>About this page</SheetTitle></SheetHeader>
        <SheetScrollBody>
          <ScrollArea className="h-full px-4 pb-4">
            <MarkdownRenderer content={OBSERVABILITY_HELP_MD} />
          </ScrollArea>
        </SheetScrollBody>
      </SheetContent>
    </Sheet>
  );
}
