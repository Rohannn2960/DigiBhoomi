/**
 * Realistic Indian Land Record Mock Dataset for DigiBhoomi Prototype
 * Follows exact subdocument schema structure for future OCR compatibility.
 * Provides sessionStorage persistence so edits survive navigation during the review session.
 */

const defaultRecords = [
  {
    _id: "doc-101",
    fileMetadata: {
      storedFilename: "b4f2c019-khasra-khatauni-sample.pdf",
      originalFilename: "UP_Bhulekh_Khatauni_Sadar_142.pdf",
      mimeType: "application/pdf",
      sizeBytes: 425600,
      sha256Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      previewUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    },
    status: "Needs review",
    createdAt: "2026-10-14T09:30:00Z",
    landDetails: {
      ownerName: {
        value: "Ram Charan Sharma",
        rawOcrText: "राम चरन शर्मा (पिता: शिव प्रसाद)",
        confidence: 0.94,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      khasraNumber: {
        value: "142/2",
        rawOcrText: "खसरा: 142/2 मि.",
        confidence: 0.91,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      khataNumber: {
        value: "00058",
        rawOcrText: "खाता सं. 00058",
        confidence: 0.96,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      landArea: {
        value: "1.4500",
        unit: "Hectare",
        rawOcrText: "क्षेत्रफल: 1.4500 हे.",
        confidence: 0.62, // Low confidence -> flagged!
        confidenceSource: "OCR_ENGINE",
        isFlagged: true,
        reviewStatus: "Unreviewed"
      },
      district: {
        value: "Lucknow",
        rawOcrText: "जनपद: लखनऊ",
        confidence: 0.98,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      tehsil: {
        value: "Sadar",
        rawOcrText: "तहसील: सदर",
        confidence: 0.97,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      village: {
        value: "Khaspur",
        rawOcrText: "ग्राम: खासपुर",
        confidence: 0.88,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      landClassification: {
        value: "Agricultural",
        rawOcrText: "कृषि भूमि (एक फसली)",
        confidence: 0.58, // Low confidence -> flagged!
        confidenceSource: "OCR_ENGINE",
        isFlagged: true,
        reviewStatus: "Unreviewed"
      }
    }
  },
  {
    _id: "doc-102",
    fileMetadata: {
      storedFilename: "92ca841e-jamabandi-fard-scan.jpg",
      originalFilename: "Haryana_Jamabandi_Karnal_389.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1248000,
      sha256Hash: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
      previewUrl: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=800&q=80"
    },
    status: "Verified",
    createdAt: "2026-10-13T14:15:00Z",
    landDetails: {
      ownerName: {
        value: "Sukhwinder Singh",
        rawOcrText: "ਸੁਖਵਿੰਦਰ ਸਿੰਘ / Sukhwinder Singh",
        confidence: 0.98,
        confidenceSource: "MANUAL_OVERRIDE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      khasraNumber: {
        value: "389//12/1",
        rawOcrText: "389//12/1",
        confidence: 0.99,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      khataNumber: {
        value: "104/118",
        rawOcrText: "Khewat 104 Khatoni 118",
        confidence: 0.97,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      landArea: {
        value: "3 Bigha 12 Biswa",
        unit: "Bigha",
        rawOcrText: "3-12-0 Bigha",
        confidence: 0.95,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      district: {
        value: "Karnal",
        rawOcrText: "District Karnal",
        confidence: 0.99,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      tehsil: {
        value: "Gharaunda",
        rawOcrText: "Tehsil Gharaunda",
        confidence: 0.98,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      village: {
        value: "Kohand",
        rawOcrText: "Hadbast Kohand 44",
        confidence: 0.96,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      landClassification: {
        value: "Irrigated Chahi",
        rawOcrText: "Nehri / Chahi Agricultural",
        confidence: 0.94,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      }
    }
  },
  {
    _id: "doc-103",
    fileMetadata: {
      storedFilename: "c18f092e-patta-deed-legacy.png",
      originalFilename: "Satbara_Pune_Haveli_712.png",
      mimeType: "image/png",
      sizeBytes: 890400,
      sha256Hash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      previewUrl: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80"
    },
    status: "Processing",
    createdAt: "2026-10-14T11:00:00Z",
    landDetails: {
      ownerName: { value: "Anand Deshmukh", rawOcrText: "आनंद देशमुख", confidence: 0.78, isFlagged: false, reviewStatus: "Unreviewed" },
      khasraNumber: { value: "78/1A", rawOcrText: "सर्व्हे नंबर: 78/1A", confidence: 0.82, isFlagged: false, reviewStatus: "Unreviewed" },
      khataNumber: { value: "419", rawOcrText: "खाते क्र. 419", confidence: 0.88, isFlagged: false, reviewStatus: "Unreviewed" },
      landArea: { value: "0.8500", unit: "Hectare", rawOcrText: "0.8500 हेक्टर", confidence: 0.81, isFlagged: false, reviewStatus: "Unreviewed" },
      district: { value: "Pune", rawOcrText: "जिल्हा: पुणे", confidence: 0.95, isFlagged: false, reviewStatus: "Unreviewed" },
      tehsil: { value: "Haveli", rawOcrText: "तालुका: हवेली", confidence: 0.94, isFlagged: false, reviewStatus: "Unreviewed" },
      village: { value: "Wagholi", rawOcrText: "गाव: वाघोली", confidence: 0.90, isFlagged: false, reviewStatus: "Unreviewed" },
      landClassification: { value: "Agricultural Jirayat", rawOcrText: "जिरायत शेतजमीन", confidence: 0.79, isFlagged: false, reviewStatus: "Unreviewed" }
    }
  },
  {
    _id: "doc-104",
    fileMetadata: {
      storedFilename: "7721ab50-bihar-ror-extract.pdf",
      originalFilename: "Bihar_Bhumi_Patna_Khasra_88.pdf",
      mimeType: "application/pdf",
      sizeBytes: 310200,
      sha256Hash: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      previewUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    },
    status: "Uploaded",
    createdAt: "2026-10-14T11:15:00Z",
    landDetails: {
      ownerName: { value: "Brajesh Kumar Yadav", rawOcrText: "ब्रजेश कुमार यादव", confidence: 0.68, isFlagged: true, reviewStatus: "Unreviewed" },
      khasraNumber: { value: "88/B", rawOcrText: "खेसरा संख्या: 88/B", confidence: 0.91, isFlagged: false, reviewStatus: "Unreviewed" },
      khataNumber: { value: "12", rawOcrText: "खाता संख्या: 12", confidence: 0.94, isFlagged: false, reviewStatus: "Unreviewed" },
      landArea: { value: "1 Bigha 10 Kattha", unit: "Bigha", rawOcrText: "1 बीघा 10 कट्ठा", confidence: 0.84, isFlagged: false, reviewStatus: "Unreviewed" },
      district: { value: "Patna", rawOcrText: "जिला: पटना", confidence: 0.97, isFlagged: false, reviewStatus: "Unreviewed" },
      tehsil: { value: "Danapur", rawOcrText: "अंचल: दानापुर", confidence: 0.95, isFlagged: false, reviewStatus: "Unreviewed" },
      village: { value: "Saguna", rawOcrText: "मौजा: सगुना", confidence: 0.91, isFlagged: false, reviewStatus: "Unreviewed" },
      landClassification: { value: "Residential Commercial", rawOcrText: "व्यावसायिक", confidence: 0.60, isFlagged: true, reviewStatus: "Unreviewed" }
    }
  },
  {
    _id: "doc-105",
    fileMetadata: {
      storedFilename: "e99120bc-gujarat-anyror-712.pdf",
      originalFilename: "Gujarat_AnyRoR_Vadodara_Survey_215.pdf",
      mimeType: "application/pdf",
      sizeBytes: 512000,
      sha256Hash: "1f82c4731804c8651b942bc3c35b67812903fe53e6b2c286e1e828dcf3289045",
      previewUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    },
    status: "Needs review",
    createdAt: "2026-10-14T11:45:00Z",
    landDetails: {
      ownerName: {
        value: "Patel Rajeshbhai Mohanbhai",
        rawOcrText: "પટેલ રાજેશભાઈ મોહનભાઈ",
        confidence: 0.93,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      khasraNumber: {
        value: "215/P",
        rawOcrText: "સર્વે નંબર: 215/પૈકી",
        confidence: 0.89,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      khataNumber: {
        value: "00312",
        rawOcrText: "ખાતા નંબર: 312",
        confidence: 0.95,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      landArea: {
        value: "2.1000",
        unit: "Hectare",
        rawOcrText: "ક્ષેત્રફળ: 2-10-00 હે.",
        confidence: 0.85,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      district: {
        value: "Vadodara",
        rawOcrText: "જિલ્લો: વડોદરા",
        confidence: 0.98,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      tehsil: {
        value: "Padra",
        rawOcrText: "તાલુકો: પાદરા",
        confidence: 0.97,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Accepted"
      },
      village: {
        value: "Luna",
        rawOcrText: "ગામ: લુણા",
        confidence: 0.92,
        confidenceSource: "OCR_ENGINE",
        isFlagged: false,
        reviewStatus: "Unreviewed"
      },
      landClassification: {
        value: "Jarayat / Dry Crop",
        rawOcrText: "જમીનનો પ્રકાર: જરાયત",
        confidence: 0.55, // Low confidence -> flagged!
        confidenceSource: "OCR_ENGINE",
        isFlagged: true,
        reviewStatus: "Unreviewed"
      }
    }
  }
];

const STORAGE_KEY = 'digibhoomi_mock_records_v1';

export function getStoredRecords() {
  if (typeof window === 'undefined') return defaultRecords;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse stored mock records", e);
    }
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(defaultRecords));
  return defaultRecords;
}

export function getRecordById(id) {
  const records = getStoredRecords();
  return records.find(r => r._id === id) || records[0];
}

export function saveStoredRecord(id, updatedLandDetails, updatedStatus) {
  if (typeof window === 'undefined') return;
  const records = getStoredRecords();
  const index = records.findIndex(r => r._id === id);
  if (index !== -1) {
    records[index] = {
      ...records[index],
      landDetails: updatedLandDetails || records[index].landDetails,
      status: updatedStatus || records[index].status,
      updatedAt: new Date().toISOString()
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
  return records;
}

export const mockRecords = defaultRecords;
