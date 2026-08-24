from PIL import Image
import os
FX = r"C:\Users\ZYJ\Documents\Agent 开发\workspace-013\city-footprint\src\assets\fx"
im = Image.open(os.path.join(FX, "cloud_l.png")).convert("RGBA")
# Rotate 90 CW so original TOP (golden sunlit) becomes RIGHT side
rot = im.transpose(Image.ROTATE_270)  # ROTATE_270 = 90 CW
# Save as cloud_l (golden now on right)
rot.save(os.path.join(FX, "cloud_l.png"))
# Mirror for cloud_r (golden on left)
mir = rot.transpose(Image.FLIP_LEFT_RIGHT)
mir.save(os.path.join(FX, "cloud_r.png"))
print("rotated:", rot.size, "mirrored:", mir.size)
