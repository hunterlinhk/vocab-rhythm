"""Verify all exports, create a checksummed review ZIP, and copy it to Desktop."""
import csv,hashlib,json,shutil,zipfile,xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/oewn-review/full'
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def text(v):return '' if v is None else str(v).lower() if isinstance(v,bool) else str(v)
def verify():
    canonical=json.loads((OUT/'canonical.json').read_text(encoding='utf-8'));datasets=canonical['datasets']
    for name,expected in datasets.items():
        for ext,sep in [('csv',','),('tsv','\t')]:
            with (OUT/f'{name}.{ext}').open(encoding='utf-8',newline='') as f:actual=list(csv.DictReader(f,delimiter=sep))
            assert len(actual)==len(expected),(name,ext)
            for a,e in zip(actual,expected):assert a=={k:text(v) for k,v in e.items()},(name,ext,e.get('sense_id') or e['headword'])
    exact=datasets['exact_senses'];ids={s['sense_id'] for s in exact}
    assert len(exact)==len(ids)==19028
    assert len({s['headword'] for s in exact})==2742
    assert sum(s['original_priority']==100 for s in exact)==26
    assert sum(s['original_priority']==0 for s in exact)==19002
    assert len({s['headword'] for s in datasets['ngsl_headwords']})==2809
    assert len({s['sense_id'] for s in datasets['case_only_senses']})==29
    assert not ids & {s['sense_id'] for s in datasets['case_only_senses']}
    with zipfile.ZipFile(OUT/'OEWN_AI_Review_Full.xlsx') as z:
        assert z.testzip() is None
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS):shared.append(''.join(t.text or '' for t in si.findall('.//m:t',NS)))
        assert len(ET.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS))==7
        names=['ngsl_headwords','exact_senses','reviewed_pilot','case_only_headwords','case_only_senses','unmatched_headwords']
        for number,name in enumerate(names,2):
            sheet=ET.fromstring(z.read(f'xl/worksheets/sheet{number}.xml'))
            rows=sheet.findall('m:sheetData/m:row',NS);expected=datasets[name];headers=list(expected[0])
            assert len(rows)==len(expected)+1,(name,len(rows))
            for row,e in zip(rows[1:],expected):
                actual={}
                for c in row.findall('m:c',NS):
                    col=0
                    for ch in ''.join(ch for ch in c.attrib['r'] if ch.isalpha()):col=col*26+ord(ch)-64
                    v=c.find('m:v',NS);t=c.attrib.get('t');value='' if v is None else v.text
                    if t=='s':value=shared[int(value)]
                    elif t=='inlineStr':value=''.join(x.text or '' for x in c.findall('.//m:t',NS))
                    elif t=='b':value='true' if value=='1' else 'false'
                    assert t!='e' and c.find('m:f',NS) is None,(name,c.attrib['r'])
                    actual[headers[col-1]]=value
                for k,v in e.items():
                    a=actual.get(k,'')
                    if isinstance(v,(int,float)) and not isinstance(v,bool):assert a!='' and float(a)==v,(name,k,a,v)
                    else:assert a==text(v),(name,k,e.get('sense_id') or e.get('headword'),a,text(v))
            assert sheet.find('m:sheetViews/m:sheetView/m:pane',NS) is not None
        assert len([n for n in z.namelist() if n.startswith('xl/tables/table') and n.endswith('.xml')])==6
    report=json.loads((OUT/'validation_report.json').read_text(encoding='utf-8'))
    report['checks'].update({'all_csv_tsv_fields_equal_canonical':True,'all_excel_fields_equal_canonical':True,'excel_7_sheets_6_filter_tables':True})
    (OUT/'validation_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    files=[]
    for p in sorted(OUT.iterdir()):
        if p.is_file() and p.name!='PACKAGE_MANIFEST.json':files.append({'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    (OUT/'PACKAGE_MANIFEST.json').write_text(json.dumps({'files':files,'note':'Covers every file in full/ except this manifest itself.'},indent=2)+'\n',encoding='utf-8')
    target=ROOT/'docs/oewn-review/OEWN_AI_Review_Full_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(OUT.iterdir()):
            if p.is_file():z.write(p,arcname='OEWN_AI_Review_Full/'+p.name)
        for p in sorted((ROOT/'docs/oewn-review/tooling').glob('*')):
            if p.is_file():z.write(p,arcname='OEWN_AI_Review_Full/tooling/'+p.name)
        z.write(ROOT/'docs/oewn-review/README.md',arcname='OEWN_AI_Review_Full/HANDOFF.md')
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        for f in files:assert hashlib.sha256(z.read('OEWN_AI_Review_Full/'+f['name'])).hexdigest()==f['sha256']
    desktop=Path.home()/'Desktop'/target.name
    shutil.copyfile(target,desktop)
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    assert hashlib.sha256(desktop.read_bytes()).hexdigest()==digest
    (target.with_suffix('.zip.sha256')).write_text(digest+'  '+target.name+'\n',encoding='utf-8')
    print(json.dumps({'verified':True,'zip':str(target),'desktop':str(desktop),'bytes':target.stat().st_size,'sha256':digest,'files_in_full':len(files)+1},ensure_ascii=False,indent=2))

if __name__=='__main__':verify()
