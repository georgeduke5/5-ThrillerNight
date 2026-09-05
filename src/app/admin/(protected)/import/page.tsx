import { ImportWizard } from "@/components/admin/ImportWizard";

export default function AdminImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Import Guests from CSV</h1>
      <ImportWizard />
    </div>
  );
}
