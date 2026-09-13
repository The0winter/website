import Link from 'next/link';
export default function NotFound() {
  return <section className="mx-auto max-w-xl px-6 py-24 text-center">
    <h1 className="text-2xl font-semibold">页面未找到</h1>
    <p className="mt-4 text-gray-500">这个链接对应的内容不存在或已下线。你可以回到首页查找作品。</p>
    <Link href="/" className="mt-6 inline-block text-blue-600">返回首页</Link>
  </section>;
}
