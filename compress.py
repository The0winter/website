import os
import shutil
from PIL import Image

# 定义文件夹路径
SOURCE_DIR = r"F:\Website\Cover"
TARGET_DIR = r"F:\Website\Cover\Image compression"
TARGET_SIZE_MB = 0.98  # 目标大小 1M
TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024

def compress_png(input_path, output_path, target_size):
    """
    通过减少图片颜色数量（量化）来压缩 PNG 图片，直到小于目标大小
    """
    # 获取原始文件大小
    original_size = os.path.getsize(input_path)
    
    # 如果本来就小于1M，直接复制过去
    if original_size <= target_size:
        shutil.copy2(input_path, output_path)
        print(f"✅ [无需压缩] {os.path.basename(input_path)} 原始大小符合要求。")
        return

    # 打开图片
    img = Image.open(input_path)
    # 确保图片是带有透明通道的 RGBA 或 RGB
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    # 初始颜色数量（最大256），逐步递减以测试大小
    colors = 256
    step = 32 # 每次减少的颜色数

    while colors >= 16:
        # 使用 P 模式（调色板模式）进行量化，这是 PNG 压缩的核心原理
        quantized_img = img.quantize(colors=colors)
        quantized_img.save(output_path, format="PNG", optimize=True)
        
        # 检查压缩后的大小
        compressed_size = os.path.getsize(output_path)
        if compressed_size <= target_size:
            print(f"✅ [压缩成功] {os.path.basename(input_path)} -> 颜色数:{colors}, 大小:{compressed_size / 1024 / 1024:.2f} MB")
            return
        
        # 如果还是太大，减少颜色数量继续尝试
        colors -= step

    print(f"⚠️ [达到极限] {os.path.basename(input_path)} 已尝试最大压缩，但可能仍略大于目标大小。")

def main():
    # 如果目标文件夹不存在，则自动创建
    if not os.path.exists(TARGET_DIR):
        os.makedirs(TARGET_DIR)

    # 遍历源文件夹下的所有文件
    for filename in os.listdir(SOURCE_DIR):
        if filename.lower().endswith(".png"):
            input_path = os.path.join(SOURCE_DIR, filename)
            output_path = os.path.join(TARGET_DIR, filename)
            
            print(f"正在处理: {filename} ...")
            compress_png(input_path, output_path, TARGET_SIZE_BYTES)

    print("\n🎉 所有图片处理完毕！已存入:", TARGET_DIR)

if __name__ == "__main__":
    main()