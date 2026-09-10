export default function LoadingBook() {
  return <div role="status" aria-label="正在打开书籍" aria-busy="true" className="min-h-screen bg-gray-50 px-4 py-6 md:py-10">
    <span className="sr-only">正在打开书籍…</span>
    <div aria-hidden="true" className="mx-auto max-w-7xl space-y-6 motion-safe:animate-pulse">
      <div className="flex gap-5 rounded-xl bg-white p-5 md:gap-8 md:p-8">
        <div className="h-36 w-24 shrink-0 rounded-lg bg-gray-200 md:h-60 md:w-40" />
        <div className="flex-1 space-y-4 py-2">
          <div className="h-7 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-1/3 rounded bg-gray-100" />
          <div className="h-4 w-2/3 rounded bg-gray-100" />
          <div className="mt-6 h-10 w-32 rounded-lg bg-blue-100" />
        </div>
      </div>
      <div className="space-y-4 rounded-xl bg-white p-5 md:p-8">
        <div className="h-5 w-24 rounded bg-gray-200" />
        <div className="h-4 w-full rounded bg-gray-100" />
        <div className="h-4 w-4/5 rounded bg-gray-100" />
      </div>
      <div className="space-y-5 rounded-xl bg-white p-5 md:p-8">
        <div className="h-5 w-24 rounded bg-gray-200" />
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-4 w-3/4 rounded bg-gray-100" />)}
      </div>
    </div>
  </div>;
}
