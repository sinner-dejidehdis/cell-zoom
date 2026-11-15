# 细胞放大（cell-zoom）

从一个人胰岛 β 细胞一路放大到原子的交互网站。当前是原型 M1：一条竖切路径，
细胞 → 线粒体 → ATP 合酶 → 催化位点的原子。内容未经领域专家审核。

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
| `src/content/levels.ts` | 层级注册表：每层的尺寸、父层、镜头距离。以后加组织、器官、人体层，在这里加记录 |
| `src/i18n/zh.json` | 全部界面文字（每层分"这是什么 / 它在做什么 / 规则 / 简化了什么 / 来源"）。加英文只需新增 `en.json` |
| `src/engine/` | 各层共用的引擎：网址路由、镜头过渡、尺度条、信息面板 |
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
- 胰岛素颗粒数：[BioNumbers 109971](https://bionumbers.hms.harvard.edu/bionumber.aspx?id=109971)。
- 细胞和线粒体模型是示意形状，不是测量重建；每层的简化之处都写在界面的"这里简化了什么"一栏。
