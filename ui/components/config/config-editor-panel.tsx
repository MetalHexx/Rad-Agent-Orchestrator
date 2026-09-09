"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetScrollBody,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfigForm } from "./config-form";
import { ConfigFooter } from "./config-footer";
import { ConfigErrorState } from "./config-error-state";
import type { UseConfigEditorReturn } from "@/hooks/use-config-editor";

interface ConfigEditorPanelProps {
  editor: UseConfigEditorReturn;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg bg-muted/50 p-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function ConfigEditorPanel({ editor }: ConfigEditorPanelProps) {
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      editor.close();
    }
  };

  const isReady = !editor.loading && !editor.loadError;

  return (
    <Sheet open={editor.isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Configuration</SheetTitle>
        </SheetHeader>

        <SheetScrollBody>
          <ScrollArea className="h-full">
            {editor.loading && (
              <div className="px-4 pb-4">
                <LoadingSkeleton />
              </div>
            )}

            {editor.loadError && (
              <div className="px-4 pb-4">
                <ConfigErrorState message={editor.loadError} onRetry={editor.retry} />
              </div>
            )}

            {isReady && editor.config && (
              <div className="px-4 pb-4">
                <ConfigForm
                  config={editor.config}
                  onChange={editor.updateField}
                  errors={editor.errors}
                  styleOptions={editor.styleOptions}
                />
              </div>
            )}
          </ScrollArea>
        </SheetScrollBody>

        {isReady && (
          <ConfigFooter
            onSave={editor.save}
            saveState={editor.saveState}
            errorMessage={editor.saveError ?? undefined}
            disabled={!editor.isDirty || Object.keys(editor.errors).length > 0}
            onDismissError={editor.dismissSaveError}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
