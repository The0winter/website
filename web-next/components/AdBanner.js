// components/AdBanner.js
import { useEffect, useRef } from 'react';

const AdBanner = ({ atOptions }) => {
  const bannerRef = useRef(null);

  useEffect(() => {
    if (bannerRef.current && !bannerRef.current.firstChild) {
      const conf = document.createElement('script');
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = `https://www.highperformanceformat.com/c499a0debce3cc11988efbef57ec87d0${atOptions.key}/invoke.js`;
      
      conf.innerHTML = `atOptions = ${JSON.stringify(atOptions)}`;

      bannerRef.current.append(conf);
      bannerRef.current.append(script);
    }
  }, [atOptions]);

  return (
    <div 
      ref={bannerRef} 
      className="my-4 flex justify-center items-center overflow-hidden"
      style={{ minHeight: '90px' }} // 防止广告加载时页面抖动
    />
  );
};

export default AdBanner;