## 3. 全部 data-dam-* 锚点（163 个 · 1183 处命中）

### 3.1 汇总

| 角色（脚本判定） | 数量 |
|---|---|
| 容器（div / span / nav / section / header / svg / g / pre …） | 135 |
| 控件（button / input / select / textarea / a） | 22 |
| JS 选择器（被 querySelector / closest 读取） | 3 |
| CSS 选择器（零 JS 消费） | 3 |
| **唯一锚点合计** | **163** |
| **含重复命中的总次数** | **1183** |

列含义：**命中行号** = 该锚点在源码里出现的全部行；**主归属** = 去掉纯 CSS 段后出现最多的组件；**次归属** = 其余出现过的组件。
分类用途：**「容器」= 结构/样式钩子，可直接复用**；**「控件」= 交互节点，团队版要覆盖时须连同事件一起重写**；**「CSS 选择器」= 只在样式表里存在、JS 从不消费 ⇒ 新增团队 UI 的安全扩展位**。

### 3.2 全量锚点总表（163 项 · 按首次出现行号排序）

| 锚点 | 角色 | 首见行 | 出现次数 | 命中行号 | 主归属 | 次归属 |
|---|---|---|---|---|---|---|
| `data-dam-sidebar-btn` | 控件 | 67 | 6 | 67, 1928, 1929, 1930, 3399, 7904 | entryButtonRect | SidebarButton、apply |
| `data-dam-page` | 容器 | 1710 | 44 | 1710, 1713, 1746, 1750, 1751, 1778, 1780, 1784, 1785, 1786, 1787, 1792, 1797, 1798, 1799, 1801, 1804, 1805, 1807, 1811, 1813, 1820, 1829, 1830, 1831, 1832, 1833, 1835, 1835, 1838, 1838, 1839, 1840, 1841, 1844, 1844, 1845, 1845, 1846, 1846, 1909, 1909, 1912, 5933 | MemoryPageView | — |
| `data-dam-panel` | JS 选择器 | 1711 | 20 | 1711, 1713, 1715, 1727, 1728, 1729, 1730, 1731, 1733, 1734, 1735, 1737, 1738, 1739, 1750, 1907, 1937, 6041, 7809, 7904 | MemoryPanel | setMany、apply |
| `data-dam-resize` | 容器 | 1740 | 3 | 1740, 1743, 6069 | MemoryPanel | — |
| `data-dam-page-head` | 容器 | 1762 | 4 | 1762, 1764, 1765, 5940 | MemoryPageView | — |
| `data-dam-page-main` | 容器 | 1768 | 4 | 1768, 1777, 1789, 5956 | MemoryPageView | — |
| `data-dam-page-nav` | 容器 | 1769 | 7 | 1769, 1771, 1774, 1777, 1790, 1909, 5957 | MemoryPageView | — |
| `data-dam-page-content` | 容器 | 1776 | 3 | 1776, 1777, 5961 | MemoryPageView | — |
| `data-dam-section` | 控件 | 1778 | 5 | 1778, 3881, 3882, 3883, 3888 | LogsTab | — |
| `data-dam-fold` | 控件 | 1780 | 8 | 1780, 1784, 1785, 1786, 1787, 1909, 1909, 3901 | FoldableLogs | — |
| `data-dam-body` | 容器 | 1792 | 10 | 1792, 1797, 1798, 1799, 1801, 1807, 1844, 1864, 5962, 6068 | MemoryPageView | MemoryPanel |
| `data-dam-flow` | 控件 | 1807 | 31 | 1807, 1809, 1811, 1813, 1820, 1829, 1830, 1831, 1832, 1833, 1844, 1912, 3815, 3817, 3881, 3892, 3893, 4273, 4274, 4510, 4511, 4512, 4977, 4978, 5034, 5035, 5063, 5064, 5442, 5793, 5794 | LogsTab | migRows×3、RefineTab×2、MemoryHubTab×2、PlanTab×2、ReflectionsTab×2、SearchTab×2、ConnectTab×2、body |
| `data-dam-card` | 容器 | 1820 | 18 | 1820, 1829, 1830, 1831, 1832, 1833, 1844, 1891, 1893, 1894, 1898, 1900, 2294, 3815, 3822, 5180, 5441, 5444 | RefineTab | body×2、Card、WorkspaceGraph |
| `data-dam-btn` | 控件 | 1835 | 143 | 1835, 1838, 1845, 1846, 1847, 1848, 1849, 1908, 1913, 2514, 2573, 2815, 2817, 2818, 2921, 3225, 3230, 3341, 3496, 3509, 3581, 3591, 3603, 3674, 3694, 3700, 3752, 3790, 3876, 3912, 4010, 4012, 4016, 4019, 4043, 4149, 4167, 4168, 4218, 4224, 4233, 4234, 4235, 4236, 4436, 4437, 4448, 4470, 4472, 4477, 4479, 4498, 4499, 4500, 4501, 4548, 4827, 4830, 4835, 4884, 4958, 4962, 4966, 4971, 5020, 5023, 5030, 5067, 5068, 5434, 5438, 5445, 5513, 5515, 5516, 5637, 5639, 5640, 5665, 5666, 5768, 5772, 5772, 5773, 5773, 5786, 5797, 5798, 5944, 5949, 6023, 6058, 6064, 6065, 6066, 6235, 6280, 6792, 6818, 6830, 6854, 6862, 6875, 6882, 6898, 7027, 7028, 7166, 7170, 7175, 7217, 7423, 7447, 7450, 7460, 7461, 7477, 7478, 7486, 7562, 7563, 7564, 7565, 7584, 7597, 7598, 7628, 7637, 7698, 7699, 7730, 7784, 7788, 7791, 7795, 7796, 7832, 7854, 7855, 7860, 7861, 7875, 7880 | setMany | MemoryHubTab×9、migRows×8、PlanTab×8、CalendarTab×8、ConnectTab×8、DialogHost×8、RulesEditPanel×5、MemoryPanel×5、KanbanView×4、SettingsPage×4、WhiteboardGraphView×3、PySetupWizard×3、OverviewTab×3、StorageTab×3、ReflectionsTab×3、body×3、GreetingCard×2、RefineTab×2、SearchTab×2、MemoryPageView×2、DebugCenter×2、AutoContinueHost×2、KanbanCard、KanbanBoard、LogsTab、FoldableLogs、NotesTab |
| `data-dam-tab` | 控件 | 1835 | 14 | 1835, 1838, 1839, 1841, 1845, 1846, 1858, 1862, 1863, 1900, 1911, 1913, 5876, 6023 | TabScroller | MemoryPanel |
| `data-dam-tabs-wrap` | 容器 | 1850 | 2 | 1850, 5874 | TabScroller | — |
| `data-dam-tabs` | 容器 | 1851 | 3 | 1851, 1852, 5876 | TabScroller | — |
| `data-dam-tab-strip` | 容器 | 1854 | 4 | 1854, 1857, 1900, 5876 | TabScroller | — |
| `data-dam-tabs-arrow` | 控件 | 1859 | 7 | 1859, 1860, 1861, 1908, 1913, 5875, 5877 | TabScroller | — |
| `data-dam-settings` | 容器 | 1865 | 2 | 1865, 7421 | setMany | — |
| `data-dam-settings-nav` | 容器 | 1866 | 4 | 1866, 1867, 1868, 7422 | setMany | — |
| `data-dam-settings-content` | 容器 | 1869 | 2 | 1869, 7425 | setMany | — |
| `data-dam-settings-group` | 容器 | 1870 | 4 | 1870, 1871, 1872, 7416 | setMany | — |
| `data-dam-settings-row` | 容器 | 1873 | 3 | 1873, 1877, 7349 | setMany | — |
| `data-dam-savebar` | 容器 | 1874 | 6 | 1874, 1875, 1876, 1910, 1910, 7874 | setMany | — |
| `data-dam-row` | 容器 | 1877 | 44 | 1877, 1925, 1926, 3693, 4467, 4474, 4497, 4547, 4826, 4883, 4961, 4965, 5022, 5065, 5433, 5512, 5518, 5636, 5657, 5664, 5777, 5785, 5796, 6132, 6234, 6270, 6278, 6279, 6283, 7164, 7214, 7350, 7542, 7604, 7636, 7696, 7728, 7782, 7786, 7793, 7830, 7853, 7858, 7869 | setMany | DebugCenter×6、CalendarTab×5、PlanTab×4、migRows×3、ConnectTab×3、SettingsPage×2、OverviewTab、NotesTab、ReflectionsTab、SearchTab、body |
| `data-dam-graph-toolbar` | 容器 | 1878 | 3 | 1878, 1879, 5438 | body | — |
| `data-dam-graph` | 容器 | 1880 | 5 | 1880, 1881, 1882, 1883, 5150 | WorkspaceGraph | — |
| `data-dam-graph-node` | JS 选择器 | 1884 | 3 | 1884, 5104, 5164 | WorkspaceGraph | — |
| `data-dam-graph-legend` | CSS 选择器 | 1885 | 1 | 1885 | （纯 CSS，无 JS 归属） | — |
| `data-dam-legend-dot` | CSS 选择器 | 1886 | 3 | 1886, 1887, 1888 | （纯 CSS，无 JS 归属） | — |
| `data-dam-kv` | 容器 | 1889 | 4 | 1889, 1890, 3682, 3701 | OverviewTab | — |
| `data-dam-disclosure` | 容器 | 1895 | 5 | 1895, 1896, 1897, 1900, 3391 | AnimatedDisclosure | — |
| `data-dam-banner` | 容器 | 1898 | 4 | 1898, 1900, 1922, 2290 | Banner | — |
| `data-dam-tour-orb-wrap` | 容器 | 1900 | 20 | 1900, 2027, 2029, 2079, 2080, 2081, 2082, 2083, 2084, 2085, 2205, 2206, 2207, 2208, 2209, 2210, 2211, 2212, 2213, 6693 | DialogHost | — |
| `data-dam-update-box` | 容器 | 1900 | 6 | 1900, 2252, 2256, 2256, 2263, 6385 | DialogHost | — |
| `data-dam-tour-bokeh` | 容器 | 1901 | 12 | 1901, 2031, 2033, 2035, 2037, 2269, 6388, 6389, 6390, 6695, 6696, 6697 | DialogHost | — |
| `data-dam-tour-slab` | 容器 | 1901 | 20 | 1901, 2045, 2051, 2054, 2057, 2058, 2059, 2060, 2062, 2063, 2064, 2270, 2271, 2272, 6392, 6393, 6394, 6699, 6700, 6701 | DialogHost | — |
| `data-dam-tour-orb-core` | CSS 选择器 | 1901 | 3 | 1901, 2067, 2273 | （纯 CSS，无 JS 归属） | — |
| `data-dam-update-stage` | 容器 | 1902 | 4 | 1902, 2253, 2256, 6386 | DialogHost | — |
| `data-dam-update-content` | 容器 | 1903 | 8 | 1903, 2257, 2259, 2260, 2261, 2262, 2263, 6397 | DialogHost | — |
| `data-dam-calendar` | 容器 | 1907 | 7 | 1907, 1908, 1911, 1914, 1915, 1916, 5671 | CalendarTab | — |
| `data-dam-calendar-event` | 容器 | 1907 | 6 | 1907, 1917, 1918, 5552, 5613, 5620 | CalendarTab | — |
| `data-dam-calendar-modal` | 容器 | 1907 | 4 | 1907, 1919, 5635, 5646 | CalendarTab | — |
| `data-dam-calendar-day` | 容器 | 1908 | 5 | 1908, 1911, 1915, 1916, 5538 | CalendarTab | — |
| `data-dam-input` | 控件 | 1924 | 60 | 1924, 2589, 2814, 3243, 4004, 4035, 4446, 4468, 4475, 4546, 4836, 5066, 5656, 5658, 5661, 5662, 5663, 6023, 7189, 7429, 7430, 7431, 7440, 7619, 7622, 7624, 7625, 7626, 7634, 7642, 7644, 7645, 7646, 7647, 7649, 7650, 7658, 7659, 7660, 7661, 7679, 7682, 7683, 7684, 7689, 7720, 7729, 7734, 7735, 7737, 7738, 7740, 7763, 7775, 7780, 7781, 7783, 7798, 7803, 7821 | setMany | CalendarTab×5、RulesEditPanel×2、migRows×2、KanbanBoard、KanbanView、WhiteboardGraphView、StorageTab、NotesTab、PlanTab、SearchTab、MemoryPanel、SettingsPage |
| `data-dam-select` | 控件 | 1924 | 15 | 1924, 4443, 5659, 6023, 7432, 7436, 7442, 7556, 7670, 7800, 7807, 7809, 7812, 7814, 7816 | setMany | StorageTab、CalendarTab、MemoryPanel |
| `data-dam-hint` | 容器 | 1927 | 163 | 1927, 2505, 2507, 2519, 2521, 2523, 2552, 2579, 2583, 2603, 2608, 2612, 2625, 2640, 2646, 2731, 2734, 2803, 2816, 2821, 2822, 2824, 2859, 2892, 2923, 3086, 3104, 3113, 3224, 3237, 3247, 3299, 3343, 3344, 3345, 3519, 3520, 3521, 3526, 3688, 3691, 3695, 3696, 3697, 3884, 3887, 3909, 3986, 3987, 3990, 3991, 3992, 3993, 3998, 4033, 4048, 4113, 4132, 4133, 4140, 4155, 4164, 4179, 4186, 4192, 4198, 4204, 4239, 4241, 4254, 4260, 4263, 4271, 4418, 4420, 4424, 4427, 4440, 4453, 4456, 4464, 4466, 4483, 4484, 4490, 4492, 4494, 4496, 4506, 4507, 4545, 4549, 4825, 4836, 4852, 4859, 4880, 4887, 4896, 4899, 4930, 4936, 4937, 4939, 4944, 4947, 4954, 4970, 4972, 5024, 5072, 5073, 5081, 5435, 5437, 5438, 5438, 5439, 5446, 5447, 5613, 5669, 5770, 5783, 5788, 5795, 5942, 6054, 6130, 6236, 6262, 6264, 6267, 6273, 6281, 6285, 7023, 7029, 7167, 7178, 7184, 7187, 7222, 7224, 7351, 7464, 7475, 7479, 7482, 7485, 7568, 7600, 7613, 7615, 7633, 7656, 7674, 7792, 7806, 7865, 7867, 7876, 7877 | setMany | MemoryHubTab×17、PlanTab×17、migRows×10、KanbanBoard×9、RulesEditPanel×9、KanbanView×8、DebugCenter×8、WhiteboardGraphView×7、StorageTab×7、body×7、SettingsPage×6、KanbanCard×5、OverviewTab×5、GreetingCard×4、ConnectTab×4、WbgNode×3、SearchTab×3、KanbanMatrixCard×2、LogsTab×2、NotesTab×2、CalendarTab×2、AutoContinueHost×2、FoldableLogs、ReflectionsTab、MemoryPageView、MemoryPanel |
| `data-dam-error` | 容器 | 1931 | 14 | 1931, 4463, 4551, 5667, 5670, 5707, 5780, 5800, 7168, 7305, 7466, 7572, 7574, 7882 | setMany | ConnectTab×3、CalendarTab×2、SettingsPage×2、migRows、NotesTab |
| `data-dam-muted` | 容器 | 1932 | 7 | 1932, 3501, 3514, 4890, 4967, 5026, 5761 | GreetingCard | PlanTab×2、ReflectionsTab、ConnectTab |
| `data-dam-loading` | 容器 | 1933 | 2 | 1933, 3353 | Loading | — |
| `data-dam-spinner` | 容器 | 1934 | 2 | 1934, 3353 | Loading | — |
| `data-dam-tour-backdrop` | 容器 | 1939 | 4 | 1939, 2199, 6458, 6681 | DialogHost | — |
| `data-dam-tour` | JS 选择器 | 1942 | 9 | 1942, 1950, 1960, 2200, 2204, 6361, 6459, 6684, 6690 | DialogHost | — |
| `data-dam-tour-glare` | 容器 | 1952 | 2 | 1952, 6691 | DialogHost | — |
| `data-dam-tour-close` | 控件 | 1954 | 3 | 1954, 1956, 6692 | DialogHost | — |
| `data-dam-wb-setup` | 容器 | 1958 | 6 | 1958, 1962, 1976, 1978, 2022, 6458 | DialogHost | — |
| `data-dam-wb-card` | 容器 | 1958 | 37 | 1958, 1962, 1976, 1978, 1980, 1982, 1984, 1985, 1986, 1987, 1989, 1991, 1992, 1993, 1994, 1995, 1996, 1999, 2001, 2003, 2003, 2004, 2008, 2009, 2012, 2014, 2015, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 6457, 6459 | DialogHost | — |
| `data-dam-wb-head` | 容器 | 1980 | 3 | 1980, 1982, 6460 | DialogHost | — |
| `data-dam-wb-phase` | 容器 | 1984 | 4 | 1984, 1985, 1986, 6460 | DialogHost | — |
| `data-dam-wb-sub` | 容器 | 1987 | 2 | 1987, 6463 | DialogHost | — |
| `data-dam-wb-row` | 容器 | 1989 | 3 | 1989, 2023, 6434 | DialogHost | — |
| `data-dam-wb-dot` | 容器 | 1991 | 2 | 1991, 6435 | DialogHost | — |
| `data-dam-wb-state` | 容器 | 1992 | 4 | 1992, 1993, 1994, 6435 | DialogHost | — |
| `data-dam-wb-label` | 容器 | 1995 | 2 | 1995, 6436 | DialogHost | — |
| `data-dam-wb-detail` | 容器 | 1996 | 3 | 1996, 2024, 6437 | DialogHost | — |
| `data-dam-wb-reason` | 容器 | 1999 | 2 | 1999, 6481 | DialogHost | — |
| `data-dam-wb-dir` | 容器 | 2001 | 3 | 2001, 2003, 6482 | DialogHost | — |
| `data-dam-wb-risk` | 容器 | 2003 | 3 | 2003, 2004, 6487 | DialogHost | — |
| `data-dam-wb-actions` | 容器 | 2008 | 3 | 2008, 2025, 6497 | DialogHost | — |
| `data-dam-wb-cta` | 控件 | 2012 | 3 | 2012, 2014, 6498 | DialogHost | — |
| `data-dam-wb-cta2` | 控件 | 2015 | 3 | 2015, 2017, 6504 | DialogHost | — |
| `data-dam-wb-foot` | 容器 | 2020 | 2 | 2020, 6506 | DialogHost | — |
| `data-dam-tour-stage` | 容器 | 2041 | 4 | 2041, 2267, 6391, 6698 | DialogHost | — |
| `data-dam-tour-app-tile` | 容器 | 2076 | 12 | 2076, 2078, 2079, 2080, 2081, 2082, 2083, 2084, 2085, 2221, 2225, 6701 | DialogHost | — |
| `data-dam-tour-art` | 容器 | 2088 | 46 | 2088, 2089, 2090, 2091, 2092, 2093, 2094, 2095, 2096, 2097, 2101, 2102, 2103, 2103, 2107, 2108, 2108, 2108, 2111, 2112, 2113, 2116, 2117, 2117, 2120, 2120, 2120, 2120, 2121, 2123, 2123, 2123, 2124, 2126, 2126, 2127, 2129, 2129, 2130, 2130, 2132, 2132, 2132, 2132, 2133, 6679 | DialogHost | — |
| `data-dam-tour-body` | 容器 | 2134 | 3 | 2134, 2226, 6704 | DialogHost | — |
| `data-dam-tour-kicker` | 容器 | 2135 | 3 | 2135, 2228, 6706 | DialogHost | — |
| `data-dam-tour-title` | 容器 | 2136 | 3 | 2136, 2233, 6708 | DialogHost | — |
| `data-dam-tour-text` | 容器 | 2137 | 3 | 2137, 2234, 6709 | DialogHost | — |
| `data-dam-tour-swap` | 容器 | 2138 | 2 | 2138, 6704 | DialogHost | — |
| `data-dam-tour-dl` | 容器 | 2140 | 2 | 2140, 6729 | DialogHost | — |
| `data-dam-tour-dl-row` | 容器 | 2141 | 3 | 2141, 6730, 6735 | DialogHost | — |
| `data-dam-tour-dl-tier` | 容器 | 2142 | 2 | 2142, 6737 | DialogHost | — |
| `data-dam-tour-dl-tier-row` | 容器 | 2143 | 6 | 2143, 2144, 2145, 2146, 6738, 6741 | DialogHost | — |
| `data-dam-tour-bar` | 容器 | 2147 | 2 | 2147, 6733 | DialogHost | — |
| `data-dam-tour-bar-i` | 容器 | 2148 | 2 | 2148, 6734 | DialogHost | — |
| `data-dam-tour-dots` | 容器 | 2149 | 3 | 2149, 2235, 6770 | DialogHost | — |
| `data-dam-tour-dot` | 控件 | 2150 | 7 | 2150, 2151, 2152, 2236, 2237, 2238, 6772 | DialogHost | — |
| `data-dam-tour-foot` | 容器 | 2153 | 3 | 2153, 2239, 6775 | DialogHost | — |
| `data-dam-tour-skip` | 控件 | 2154 | 4 | 2154, 2155, 2240, 6776 | DialogHost | — |
| `data-dam-tour-btn` | 控件 | 2156 | 12 | 2156, 2157, 2158, 2159, 2160, 2161, 2241, 2242, 2243, 2244, 6777, 6780 | DialogHost | — |
| `data-dam-tour-badge` | 容器 | 2162 | 3 | 2162, 6747, 6750 | DialogHost | — |
| `data-dam-tour-rec` | 容器 | 2163 | 2 | 2163, 6715 | DialogHost | — |
| `data-dam-tour-toggles` | 容器 | 2165 | 7 | 2165, 2166, 2167, 2168, 2245, 6710, 6719 | DialogHost | — |
| `data-dam-tour-tg` | 控件 | 2169 | 8 | 2169, 2170, 2171, 2172, 2246, 2247, 6713, 6723 | DialogHost | — |
| `data-dam-tour-tg-txt` | 容器 | 2173 | 3 | 2173, 6714, 6724 | DialogHost | — |
| `data-dam-tour-tg-name` | 容器 | 2174 | 3 | 2174, 6715, 6725 | DialogHost | — |
| `data-dam-tour-tg-sub` | 容器 | 2175 | 3 | 2175, 6716, 6726 | DialogHost | — |
| `data-dam-tour-sw` | 容器 | 2176 | 6 | 2176, 2177, 2178, 2179, 6717, 6727 | DialogHost | — |
| `data-dam-tour-chips` | 容器 | 2180 | 3 | 2180, 2249, 6745 | DialogHost | — |
| `data-dam-tour-links` | 容器 | 2181 | 3 | 2181, 2184, 6760 | DialogHost | — |
| `data-dam-tour-link` | 控件 | 2185 | 6 | 2185, 2191, 2193, 6761, 6763, 6766 | DialogHost | — |
| `data-dam-tour-links-note` | 容器 | 2194 | 2 | 2194, 6768 | DialogHost | — |
| `data-dam-tour-where` | 容器 | 2195 | 4 | 2195, 2196, 2248, 6752 | DialogHost | — |
| `data-dam-tour-halo` | 容器 | 2214 | 2 | 2214, 6694 | DialogHost | — |
| `data-dam-tour-pedestal` | 容器 | 2218 | 2 | 2218, 6703 | DialogHost | — |
| `data-dam-tour-head` | 容器 | 2227 | 2 | 2227, 6705 | DialogHost | — |
| `data-dam-tour-stepchip` | 容器 | 2232 | 2 | 2232, 6707 | DialogHost | — |
| `data-dam-update-click` | 容器 | 2255 | 3 | 2255, 2256, 6396 | DialogHost | — |
| `data-dam-update-logo` | 容器 | 2266 | 8 | 2266, 2267, 2269, 2270, 2271, 2272, 2273, 6387 | DialogHost | — |
| `data-dam-update-hint` | 容器 | 2274 | 2 | 2274, 6395 | DialogHost | — |
| `data-dam-kx-full` | 容器 | 2475 | 1 | 2475 | KanbanDrawerBody | — |
| `data-dam-kcard` | 容器 | 2490 | 1 | 2490 | KanbanCard | — |
| `data-dam-kbar` | 容器 | 2577 | 1 | 2577 | KanbanBoard | — |
| `data-dam-kanban` | 容器 | 2627 | 1 | 2627 | KanbanBoard | — |
| `data-dam-layout` | 容器 | 2627 | 1 | 2627 | KanbanBoard | — |
| `data-dam-lane` | 容器 | 2633 | 1 | 2633 | KanbanBoard | — |
| `data-dam-kx-badge` | 容器 | 2689 | 1 | 2689 | kxBadge | — |
| `data-dam-kx-card` | 容器 | 2702 | 1 | 2702 | KanbanMatrixCard | — |
| `data-dam-kx-lane` | 容器 | 2703 | 1 | 2703 | KanbanMatrixCard | — |
| `data-dam-kanban-view` | 容器 | 2792 | 1 | 2792 | KanbanView | — |
| `data-dam-kx-scroll` | 容器 | 2799 | 2 | 2799, 2897 | KanbanView | — |
| `data-dam-kx-warn` | 容器 | 2808 | 1 | 2808 | KanbanView | — |
| `data-dam-kx-empty` | 容器 | 2821 | 3 | 2821, 2822, 2824 | KanbanView | — |
| `data-dam-kx-head` | 容器 | 2838 | 2 | 2838, 2846 | KanbanView | — |
| `data-dam-kx-dot` | 容器 | 2854 | 1 | 2854 | KanbanView | — |
| `data-dam-kx-row` | 容器 | 2867 | 1 | 2867 | KanbanView | — |
| `data-dam-kx-cell` | 容器 | 2883 | 1 | 2883 | KanbanView | — |
| `data-dam-kx-drawer` | 容器 | 2905 | 1 | 2905 | KanbanView | — |
| `data-dam-chip` | 容器 | 2931 | 1 | 2931 | KanbanView | — |
| `data-dam-wbg-node` | 容器 | 3065 | 1 | 3065 | WbgNode | — |
| `data-dam-wbg-wrap` | 容器 | 3223 | 2 | 3223, 3304 | WhiteboardGraphView | — |
| `data-dam-wbg-bar` | 容器 | 3233 | 1 | 3233 | WhiteboardGraphView | — |
| `data-dam-wbg-colhead` | 容器 | 3286 | 1 | 3286 | WhiteboardGraphView | — |
| `data-dam-wbg-canvas` | 容器 | 3309 | 1 | 3309 | WhiteboardGraphView | — |
| `data-dam-wbg-stage` | 容器 | 3320 | 1 | 3320 | WhiteboardGraphView | — |
| `data-dam-wbg-side` | 容器 | 3333 | 1 | 3333 | WhiteboardGraphView | — |
| `data-dam-content` | 容器 | 3459 | 30 | 3459, 3875, 3886, 4015, 4049, 4131, 4158, 4163, 4177, 4199, 4245, 4246, 4267, 4269, 4432, 4824, 4861, 4867, 4892, 4903, 4933, 4954, 4957, 4969, 5019, 5071, 5085, 5446, 5782, 5787 | MemoryHubTab | PlanTab×9、LogsTab×2、RulesEditPanel×2、SearchTab×2、ConnectTab×2、GreetingCard、StorageTab、ReflectionsTab、body |
| `data-dam-collapsible` | 容器 | 3673 | 1 | 3673 | OverviewTab | — |
| `data-dam-rule` | 容器 | 4029 | 1 | 4029 | RulesEditPanel | — |
| `data-dam-scope` | 容器 | 4139 | 1 | 4139 | MemoryHubTab | — |
| `data-dam-scope-to` | 控件 | 4149 | 1 | 4149 | MemoryHubTab | — |
| `data-dam-key` | 控件 | 4827 | 12 | 4827, 4830, 4835, 7621, 7623, 7651, 7665, 7677, 7678, 7681, 7854, 7855 | setMany | PlanTab×3 |
| `data-dam-official-band` | 容器 | 4931 | 1 | 4931 | PlanTab | — |
| `data-dam-water-bar` | 容器 | 4940 | 1 | 4940 | PlanTab | — |
| `data-dam-official-line` | 容器 | 4942 | 1 | 4942 | PlanTab | — |
| `data-dam-stat-donut` | 容器 | 5204 | 1 | 5204 | seg | — |
| `data-dam-stat-bars` | 容器 | 5219 | 1 | 5219 | seg | — |
| `data-dam-stat-spark` | 容器 | 5252 | 1 | 5252 | y | — |
| `data-dam-stat-heat` | 容器 | 5265 | 1 | 5265 | y | — |
| `data-dam-stat` | 容器 | 5282 | 1 | 5282 | y | — |
| `data-dam-stat-skeleton` | 容器 | 5326 | 1 | 5326 | iv | — |
| `data-dam-calendar-slot` | 容器 | 5611 | 2 | 5611, 5618 | CalendarTab | — |
| `data-dam-float-toggle` | 控件 | 5949 | 1 | 5949 | MemoryPageView | — |
| `data-dam-nav-item` | 控件 | 5959 | 1 | 5959 | MemoryPageView | — |
| `data-dam-panel-host` | 容器 | 6076 | 1 | 6076 | MemoryPanel | — |
| `data-dam-tour-` | 容器 | 6400 | 1 | 6400 | DialogHost | — |
| `data-dam-autocont` | 容器 | 7020 | 1 | 7020 | AutoContinueHost | — |
| `data-dam-autocont-confirm` | 容器 | 7021 | 1 | 7021 | AutoContinueHost | — |
| `data-dam-detect-panel` | 容器 | 7489 | 1 | 7489 | setMany | — |
| `data-dam-prompt-sections` | 容器 | 7594 | 1 | 7594 | setMany | — |
| `data-dam-pswitch` | 控件 | 7606 | 1 | 7606 | setMany | — |

### 3.3 按页面 / 组件反查（「这个组件用了哪些锚点」）

| 页面 / 组件 | 锚点数 | 锚点清单 |
|---|---|---|
| DialogHost | 67 | `data-dam-tour-orb-wrap` `data-dam-update-box` `data-dam-tour-bokeh` `data-dam-tour-slab` `data-dam-update-stage` `data-dam-update-content` `data-dam-tour-backdrop` `data-dam-tour` `data-dam-tour-glare` `data-dam-tour-close` `data-dam-wb-setup` `data-dam-wb-card` `data-dam-wb-head` `data-dam-wb-phase` `data-dam-wb-sub` `data-dam-wb-row` `data-dam-wb-dot` `data-dam-wb-state` `data-dam-wb-label` `data-dam-wb-detail` `data-dam-wb-reason` `data-dam-wb-dir` `data-dam-wb-risk` `data-dam-wb-actions` `data-dam-wb-cta` `data-dam-wb-cta2` `data-dam-wb-foot` `data-dam-tour-stage` `data-dam-tour-app-tile` `data-dam-tour-art` `data-dam-tour-body` `data-dam-tour-kicker` `data-dam-tour-title` `data-dam-tour-text` `data-dam-tour-swap` `data-dam-tour-dl` `data-dam-tour-dl-row` `data-dam-tour-dl-tier` `data-dam-tour-dl-tier-row` `data-dam-tour-bar` `data-dam-tour-bar-i` `data-dam-tour-dots` `data-dam-tour-dot` `data-dam-tour-foot` `data-dam-tour-skip` `data-dam-tour-btn` `data-dam-tour-badge` `data-dam-tour-rec` `data-dam-tour-toggles` `data-dam-tour-tg` `data-dam-tour-tg-txt` `data-dam-tour-tg-name` `data-dam-tour-tg-sub` `data-dam-tour-sw` `data-dam-tour-chips` `data-dam-tour-links` `data-dam-tour-link` `data-dam-tour-links-note` `data-dam-tour-where` `data-dam-tour-halo` `data-dam-tour-pedestal` `data-dam-tour-head` `data-dam-tour-stepchip` `data-dam-update-click` `data-dam-update-logo` `data-dam-update-hint` `data-dam-tour-` |
| setMany | 16 | `data-dam-btn` `data-dam-settings` `data-dam-settings-nav` `data-dam-settings-content` `data-dam-settings-group` `data-dam-settings-row` `data-dam-savebar` `data-dam-row` `data-dam-input` `data-dam-select` `data-dam-hint` `data-dam-error` `data-dam-key` `data-dam-detect-panel` `data-dam-prompt-sections` `data-dam-pswitch` |
| KanbanView | 10 | `data-dam-kanban-view` `data-dam-kx-scroll` `data-dam-kx-warn` `data-dam-kx-empty` `data-dam-kx-head` `data-dam-kx-dot` `data-dam-kx-row` `data-dam-kx-cell` `data-dam-kx-drawer` `data-dam-chip` |
| MemoryPageView | 8 | `data-dam-page` `data-dam-page-head` `data-dam-page-main` `data-dam-page-nav` `data-dam-page-content` `data-dam-body` `data-dam-float-toggle` `data-dam-nav-item` |
| WhiteboardGraphView | 6 | `data-dam-wbg-wrap` `data-dam-wbg-bar` `data-dam-wbg-colhead` `data-dam-wbg-canvas` `data-dam-wbg-stage` `data-dam-wbg-side` |
| TabScroller | 5 | `data-dam-tab` `data-dam-tabs-wrap` `data-dam-tabs` `data-dam-tab-strip` `data-dam-tabs-arrow` |
| CalendarTab | 5 | `data-dam-calendar` `data-dam-calendar-event` `data-dam-calendar-modal` `data-dam-calendar-day` `data-dam-calendar-slot` |
| KanbanBoard | 4 | `data-dam-kbar` `data-dam-kanban` `data-dam-layout` `data-dam-lane` |
| MemoryPanel | 3 | `data-dam-panel` `data-dam-resize` `data-dam-panel-host` |
| （纯 CSS，无 JS 归属） | 3 | `data-dam-graph-legend` `data-dam-legend-dot` `data-dam-tour-orb-core` |
| MemoryHubTab | 3 | `data-dam-content` `data-dam-scope` `data-dam-scope-to` |
| PlanTab | 3 | `data-dam-official-band` `data-dam-water-bar` `data-dam-official-line` |
| y | 3 | `data-dam-stat-spark` `data-dam-stat-heat` `data-dam-stat` |
| LogsTab | 2 | `data-dam-section` `data-dam-flow` |
| WorkspaceGraph | 2 | `data-dam-graph` `data-dam-graph-node` |
| OverviewTab | 2 | `data-dam-kv` `data-dam-collapsible` |
| Loading | 2 | `data-dam-loading` `data-dam-spinner` |
| KanbanMatrixCard | 2 | `data-dam-kx-card` `data-dam-kx-lane` |
| seg | 2 | `data-dam-stat-donut` `data-dam-stat-bars` |
| AutoContinueHost | 2 | `data-dam-autocont` `data-dam-autocont-confirm` |
| entryButtonRect | 1 | `data-dam-sidebar-btn` |
| FoldableLogs | 1 | `data-dam-fold` |
| RefineTab | 1 | `data-dam-card` |
| body | 1 | `data-dam-graph-toolbar` |
| AnimatedDisclosure | 1 | `data-dam-disclosure` |
| Banner | 1 | `data-dam-banner` |
| GreetingCard | 1 | `data-dam-muted` |
| KanbanDrawerBody | 1 | `data-dam-kx-full` |
| KanbanCard | 1 | `data-dam-kcard` |
| kxBadge | 1 | `data-dam-kx-badge` |
| WbgNode | 1 | `data-dam-wbg-node` |
| RulesEditPanel | 1 | `data-dam-rule` |
| iv | 1 | `data-dam-stat-skeleton` |

### 3.4 零 JS 消费的 CSS 锚点（新增团队 UI 的安全扩展位，3 个）

这些锚点**只出现在 CSS 选择器里**，JS 侧从不读取。按「追加式覆盖」纪律在此扩展不会破坏任何既有守卫。

| 锚点 | 命中行号 |
|---|---|
| `data-dam-graph-legend` | 1885 |
| `data-dam-legend-dot` | 1886, 1887, 1888 |
| `data-dam-tour-orb-core` | 1901, 2067, 2273 |

### 3.5 高复用锚点（命中 ≥15 处 · 14 个）

改动这些锚点的影响面最大，企业版做皮肤/主题时必须先跑它们的字符串锚定守卫。

| 锚点 | 命中次数 | 参与组件数 |
|---|---|---|
| `data-dam-hint` | 163 | 28 |
| `data-dam-btn` | 143 | 29 |
| `data-dam-input` | 60 | 14 |
| `data-dam-tour-art` | 46 | 2 |
| `data-dam-page` | 44 | 2 |
| `data-dam-row` | 44 | 13 |
| `data-dam-wb-card` | 37 | 2 |
| `data-dam-flow` | 31 | 10 |
| `data-dam-content` | 30 | 10 |
| `data-dam-panel` | 20 | 4 |
| `data-dam-tour-orb-wrap` | 20 | 2 |
| `data-dam-tour-slab` | 20 | 2 |
| `data-dam-card` | 18 | 5 |
| `data-dam-select` | 15 | 5 |
