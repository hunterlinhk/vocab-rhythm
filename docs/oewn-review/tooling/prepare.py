"""Offline audit export. Reads the pinned archive and existing SQL; never executes SQL."""
import argparse,csv,hashlib,json,re,shutil,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/oewn-review/full'
sha=lambda b:hashlib.sha256(b).hexdigest()
def writejson(name,value): (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def prepare(archive):
    OUT.mkdir(parents=True,exist_ok=True)
    stage=ROOT/'ops/oewn-2025-ngsl'
    manifest=json.loads((stage/'manifest.json').read_text())
    checks=[]
    for f in manifest['files']:
        b=(stage/f['name']).read_bytes()
        assert sha(b)==f['sha256'] and len(b)==f['bytes'],f['name']
        checks.append(f)
    assert sha(archive.read_bytes())==manifest['archive_sha256']
    with (ROOT/'src/data/ngsl-1.2-stats.csv').open(encoding='utf-8',newline='') as f: ngsl=list(csv.DictReader(f))
    assert len(ngsl)==2809
    entries={};synsets={}
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if not name.endswith('.json') or name=='frames.json':continue
            data=json.loads(z.read(name))
            (entries if name.startswith('entries-') else synsets).update(data)
    posnames={'n':'noun','v':'verb','a':'adjective','s':'adjective','r':'adverb'}
    source={'source_id':manifest['source_id'],'source_version':manifest['source_version'],'archive_sha256':manifest['archive_sha256'],'license_id':'CC-BY-4.0','source_url':'https://en-word.net/downloads/english-wordnet-2025-json.zip','license_url':'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md','attribution':'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.'}
    first=lambda values:next((x for x in values or [] if isinstance(x,str) and x.strip()),None)
    def senses(headword):
        result=[]
        for sourcepos,entry in entries[headword].items():
            pron=entry.get('pronunciation',[])
            p=next((x for x in pron if x.get('variety')=='US'),None) or next((x for x in pron if x.get('variety')=='GB'),None) or next(iter(pron),{})
            for s in entry.get('sense',[]):
                syn=synsets[s['synset']]
                result.append({'sense_id':s['id'],'part_of_speech':posnames[sourcepos.split('-')[0]],'definition_en':first(syn.get('definition')),'source_example':first(syn.get('example')),'ipa':'/'+p['value']+'/' if p.get('value') else None,'source_pos':sourcepos})
        return result
    exact=[]
    for i in range(1,11):
        filename=f'{i:02d}-stage-batches.sql'
        for line_no,line in enumerate((stage/filename).read_text(encoding='utf-8').splitlines(),1):
            if not re.match(r'^  \(\d+, ',line):continue
            tokens=re.findall(r"'(?:''|[^'])*'|NULL|\d+",re.sub(r'\)[,;]?$','',line[3:]))
            assert len(tokens)==10,(filename,line_no)
            v=[None if t=='NULL' else t[1:-1].replace("''", "'") if t.startswith("'") else int(t) for t in tokens]
            batch,normalized,word,ref,sid,priority,pos,ipa,definition,example=v
            exact.append({'ngsl_rank':next(int(n['SFI Rank']) for n in ngsl if n['Lemma']==word),'headword':word,'normalized_word':normalized,'sense_id':sid,'part_of_speech':pos,'definition_en':definition,'source_example':example,'ipa':ipa,'original_priority':priority,'source_entry_ref':ref,'source_id':source['source_id'],'source_version':source['source_version'],'license_id':source['license_id'],'archive_sha256':source['archive_sha256'],'import_file':'ops/oewn-2025-ngsl/'+filename,'import_line':line_no,'import_file_sha256':manifest['files'][i]['sha256']})
    byword={};ids=set()
    for row in exact:
        assert row['sense_id'] not in ids;ids.add(row['sense_id'])
        byword.setdefault(row['headword'],[]).append(row)
    assert len(exact)==len(ids)==19028 and len(byword)==2742
    lexemes=[];caseheads=[];caseentries=[];unmatched=[]
    for n in ngsl:
        word=n['Lemma'];rank=int(n['SFI Rank']);matches=[w for w in entries if w.lower()==word.lower()] if word not in entries else []
        status='exact' if word in entries else 'case_only' if matches else 'unmatched'
        local=byword.get(word,[])
        if status=='exact':
            original={s['sense_id']:s for s in senses(word)}
            assert set(original)=={s['sense_id'] for s in local}
            for row in local:
                s=original[row['sense_id']]
                for k in ['part_of_speech','definition_en','source_example','ipa']:assert row[k]==s[k],row['sense_id']
                assert row['source_entry_ref']==row['sense_id'] and row['normalized_word']==word.strip().lower()
                row['source_pos']=s['source_pos']
        elif status=='case_only':
            alt=[]
            for match in matches:
                for s in senses(match):
                    row={'ngsl_rank':rank,'headword':word,'oewn_headword':match,**s,'original_priority':None,'source_entry_ref':s['sense_id'],'source_id':source['source_id'],'source_version':source['source_version'],'license_id':source['license_id'],'archive_sha256':source['archive_sha256'],'imported':False}
                    caseentries.append(row);alt.append(s['sense_id'])
            explanation={'it':'IT 缩写，不能作为代词 it。','or':'OR 缩写，不能作为连词 or。','who':'WHO 缩写，不能作为疑问词 who。','TRUE':'仅匹配小写 true；需确认原大写词头的语义与大小写身份。','FALSE':'仅匹配小写 false；需确认原大写词头的语义与大小写身份。'}[word]
            caseheads.append({'ngsl_rank':rank,'headword':word,'alternate_headwords':'; '.join(matches),'alternate_sense_count':len(alt),'alternate_sense_ids':'; '.join(alt),'explanation':explanation,'imported':False})
        else:unmatched.append({'ngsl_rank':rank,'headword':word,'explanation':'官方固定版本无精确或仅大小写词头匹配。未导入，不猜测词形、同义词或缺失 sense。','imported':False})
        pos=sorted({s['part_of_speech'] for s in local});variants=sorted({s['source_pos'] for s in local if '-' in s['source_pos']})
        pilotids=[s['sense_id'] for s in local if s['original_priority']==100]
        flags=[flag for flag,yes in [('multiple_senses',len(local)>1),('multiple_pos',len(pos)>1),('split_homograph',bool(variants)),('case_only',status=='case_only')] if yes]
        lexemes.append({'ngsl_rank':rank,'headword':word,'normalized_word':word.strip().lower(),'ngsl_sfi':float(n['SFI']),'ngsl_frequency_per_million':int(n['Adjusted Frequency per Million (U)']),'match_status':status,'sense_count':len(local),'part_of_speech':'; '.join(pos),'ambiguity':'; '.join(flags),'source_pos_variants':'; '.join(variants),'reviewed_pilot_sense_ids':'; '.join(pilotids),'review_status':'pilot_locked' if pilotids else 'not_reviewed','ai_decision':'','proposed_primary_sense_id':'','review_rationale':'','uncertainty':''})
    exact.sort(key=lambda s:(s['ngsl_rank'],s['sense_id']))
    pilots=[s for s in exact if s['original_priority']==100]
    originalpilots=json.loads((ROOT/'src/data/oewn-2025-pilot.json').read_text(encoding='utf-8'))
    assert len(pilots)==26
    for p in originalpilots:
        r=next(s for s in pilots if s['sense_id']==p['sense_key'])
        for old,new in [('word','headword'),('normalized_word','normalized_word'),('source_entry_ref','source_entry_ref'),('priority','original_priority'),('part_of_speech','part_of_speech'),('phonetic','ipa'),('definition_en','definition_en'),('sentence','source_example')]:assert p[old]==r[new]
    assert len(caseheads)==5 and len(caseentries)==29 and len(unmatched)==62
    assert sum(s['original_priority']==0 for s in exact)==19002
    datasets={'ngsl_headwords':lexemes,'exact_senses':exact,'reviewed_pilot':pilots,'case_only_headwords':caseheads,'case_only_senses':caseentries,'unmatched_headwords':unmatched}
    for name,rows in datasets.items():
        for ext,sep in [('csv',','),('tsv','\t')]:
            with (OUT/f'{name}.{ext}').open('w',encoding='utf-8',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=list(rows[0]),delimiter=sep,lineterminator='\n');writer.writeheader()
                writer.writerows({k:str(v).lower() if isinstance(v,bool) else v for k,v in r.items()} for r in rows)
    for src,dest in [(stage/'manifest.json','original_import_manifest.json'),(ROOT/'src/data/ngsl-1.2-stats.csv','original_ngsl_1.2_stats.csv'),(ROOT/'src/data/OEWN-WNDB-LICENSE.txt','OEWN-WNDB-LICENSE.txt'),(ROOT/'src/data/NGSL-SOURCE.md','NGSL-SOURCE.md')]:shutil.copyfile(src,OUT/dest)
    writejson('provenance.json',{**source,'ngsl_source':'https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv','ngsl_license':'CC-BY-SA-4.0','transformation':'Existing import first nonempty synset definition/example; US IPA preferred, then GB, then first. Case-only appendix uses the same extraction. No inferred content. source_pos is read from the verified archive.'})
    report={'baseline_main':'83edf56cbe45fdd95ad7aab54565c6e921fb8e47','counts':{name:len(rows) for name,rows in datasets.items()},'exact_headwords':len(byword),'unique_exact_sense_ids':len(ids),'priority_100':len(pilots),'priority_0':19002,'source_archive_sha256':source['archive_sha256'],'ngsl_csv_sha256':sha((ROOT/'src/data/ngsl-1.2-stats.csv').read_bytes()),'checks':{'all_15_sql_hashes_and_bytes':True,'archive_hash':True,'all_exact_ids_equal_source_archive_and_import':True,'all_exact_language_fields_equal_archive':True,'all_pilot_fields_unchanged':True,'all_ngsl_accounted_for':True,'no_duplicates':True},'sql_manifest':checks}
    writejson('validation_report.json',report)
    writejson('canonical.json',{'datasets':datasets,'source':source,'validation':report})
    print(json.dumps({'counts':report['counts'],'exact_headwords':2742,'case_only':[(r['headword'],r['alternate_headwords']) for r in caseheads]},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);args=parser.parse_args();prepare(args.archive)
