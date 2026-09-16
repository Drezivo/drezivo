import json
from pathlib import Path
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_html
from graphify.diagnostics import diagnose_extraction, format_diagnostic_report
from graphify.detect import save_manifest
from graphify.cache import save_semantic_cache
out=Path('graphify-out'); root=(out/'input').resolve()
e=json.loads((out/'.graphify_chunk_01.json').read_text(encoding='utf-8-sig'))
d=json.loads((out/'.graphify_detect.json').read_text(encoding='utf-8'))
(out/'.graphify_extract.json').write_text(json.dumps(e,indent=2),encoding='utf-8')
G=build_from_json(e,root=str(root),directed=False)
if not G.number_of_nodes(): raise SystemExit('ERROR: empty extraction')
c=cluster(G); cohesion=score_all(G,c); gods=god_nodes(G); surprises=surprising_connections(G,c)
labels={
    0:'Checkout & Customer Payments',
    1:'Rentivo Platform & Plans',
    2:'Inventory & Availability',
    3:'Reservations & Operations',
    4:'Payment Confirmation & Metrics',
    5:'Notifications & Account Security',
    6:'Storefront Policies & Verification',
}
if (out/'.graphify_labels.json').exists(): labels={int(k):v for k,v in json.loads((out/'.graphify_labels.json').read_text()).items()}
questions=suggest_questions(G,c,labels)
if not to_json(G,c,str(out/'graph.json')): raise SystemExit('ERROR: shrink guard blocked output')
report=generate(G,c,cohesion,labels,gods,surprises,d,{'input':0,'output':0},str(root),suggested_questions=questions)
report+='\n\n## Audit scope and token accounting\n\nThis graph represents the original Rentivo-PRD.md v1.0 only, copied without modification into input/. It does not represent the enhanced PRD, research, TRD, or proposed database model. Source-line evidence refers to this frozen copy. Host semantic extraction token counts are unavailable from the collaboration tool; numeric zero placeholders are not measured zero usage.\n'
(out/'GRAPH_REPORT.md').write_text(report,encoding='utf-8')
to_html(G,c,str(out/'graph.html'),community_labels=labels)
s=diagnose_extraction(e,directed=False,root=str(root))
(out/'GRAPH_HEALTH.txt').write_text(format_diagnostic_report(s),encoding='utf-8')
print(format_diagnostic_report(s))
save_manifest(d['files'],root=root)
save_semantic_cache(e['nodes'],e['edges'],e.get('hyperedges',[]),root=root)
(out/'cost.json').write_text(json.dumps({'runs':[{'input_tokens':None,'output_tokens':None,'files':1,'accounting':'unavailable: host collaboration tool provides no usage counts'}]},indent=2),encoding='utf-8')
print('Graph:',G.number_of_nodes(),'nodes,',G.number_of_edges(),'edges,',len(c),'communities')
print(json.dumps({cid:[G.nodes[n].get('label',n) for n in members] for cid,members in c.items()}))

