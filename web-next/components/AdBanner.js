// components/AdBanner.js
import { useEffect, useRef } from 'react';

const AdBanner = ({ atOptions }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const { key, format, height, width, params } = atOptions;

    // 1. 我们手动构建一个完整的 HTML 字符串
    // 这是一个"微型网页"，里面只有广告代码
    const adHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
          </style>
        </head>
        <body>
          <script type="text/javascript">
            atOptions = {
              'key' : '${key}',
              'format' : '${format}',
              'height' : ${height},
              'width' : ${width},
              'params' : ${JSON.stringify(params || {})}
            };
          </script>
          <script type="text/javascript" src="//www.highperformanceformat.com/${key}/invoke.js"></script>
        </body>
      </html>
    `;

    // 2. 创建一个 iframe 元素
    const iframe = document.createElement('iframe');
    
    // 设置 iframe 的属性
    iframe.width = width;
    iframe.height = height;
    iframe.style.border = 'none';
    iframe.style.overflow = 'hidden';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
    
    // 3. 把这个 iframe 放到我们的容器里
    const container = containerRef.current;
    container.innerHTML = ''; // 清空之前的（如果有）
    container.appendChild(iframe);

    // 4. 关键步骤：把 HTML 写入 iframe 的文档流
    // 这样 ad script 就会觉得它在一个正常的页面里，可以正常执行 document.write
    try {
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(adHtml);
      doc.close();
    } catch (e) {
      console.error('AdBanner render error:', e);
    }

  }, [atOptions]); // 只要配置变了，就重新画这个 iframe

  return (
    <div 
      ref={containerRef} 
      className="flex justify-center items-center overflow-hidden bg-transparent"
      style={{ width: atOptions.width, height: atOptions.height }}
    />
  );
};

export default AdBanner;