# 细胞放大（cell-zoom）

从一个人胰岛 β 细胞一路放大到原子的交互网站。当前是原型 M1.1：一条竖切路径，
细胞 → 线粒体 → ATP 合酶 → 催化位点的原子。内容未经领域专家审核。

操作：滚轮朝光标处连续放大缩小，靠近某个结构时会自动进入它所在的下一层，缩小则回到上一层；
左键拖动旋转；右键拖动、Shift + 拖动、方向键或 WASD 平移；点击一个结构可以直接飞进去。各层按真实比例嵌套（每层都画在上一层里它真实的位置和大小），
左侧的尺度阶梯显示当前视野宽度在各层之间的位置。

## 运行

```bash
npm install
npm run dev      # 本地开发，打开终端里显示的地址
npm run build    # 生成 dist/，可部署到任何静态托管
```

需要 Node 20 以上，以及支持 WebGL 2 的浏览器（优先电脑端）。

## 结构

| 位置 | 内容 |
| --- | --- |
| `src/content/levels.ts` | 层级注册表：每层的尺寸、父层、镜头距离、进出下一层的距离阈值，以及细胞参数（每个数值写明出处） |
| `src/i18n/zh.json` | 全部界面文字（每层分"这是什么 / 它在做什么 / 规则 / 简化了什么 / 来源"）。加英文只需新增 `en.json` |
| `src/engine/` | 各层共用的引擎：`anchors.ts`（子层在父层里的位置矩阵）、`Controller.tsx`（镜头、滚轮缩放、跨层切换）、`World.tsx`（同时画父层、当前层、子层）、数据预加载、信息面板 |
| `src/scenes/` | 每层一个 3D 场景 |
| `tools/blender/` | 用 Blender 脚本生成细胞和线粒体模型（`public/models/`） |
| `tools/pdb/` | 从 RCSB PDB 下载结构并转成网站用的紧凑格式（`public/data/`） |

## 重新生成数据

```bash
# 结构数据（只用 Python 标准库）
python3 tools/pdb/build_atp_synthase.py

# 3D 模型（需要 Blender 5.3 的 Python 模块：pip install bpy==5.3.0，Python 3.13）
python tools/blender/build_cell.py
python tools/blender/build_mitochondrion.py
```

## 数据来源

- ATP 合酶：[RCSB PDB 8H9S](https://www.rcsb.org/structure/8H9S)，人线粒体 ATP 合酶，冷冻电镜 2.53 Å（Mol Cell, 2023）。
- β 细胞平均体积 1,158 µm³：[PubMed 22797400](https://pubmed.ncbi.nlm.nih.gov/22797400/)（模型是同体积的球，直径 13.0 µm）。
- 胰岛素颗粒数：[BioNumbers 109971](https://bionumbers.hms.harvard.edu/bionumber.aspx?id=109971)；直径约 300 nm，随物种和固定方法变化（[Diabetologia 2012](https://link.springer.com/content/pdf/10.1007/s00125-011-2438-4.pdf)，大鼠）。
- 线粒体体积占 β 细胞 3.1%（非糖尿病供体）：[Diabetologia 2005](https://link.springer.com/article/10.1007/s00125-004-1627-9)。
- 细胞和线粒体的形状是示意，不是电镜重建；目前没有找到公开的人 β 细胞完整重建。每层的简化之处都写在界面的"这里简化了什么"一栏。
